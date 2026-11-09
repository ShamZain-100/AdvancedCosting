import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { priceListSchema, templateSchema, type TemplateInput } from '@costing/validators';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MasterService } from '../masters/master.service';
import { TemplatesService } from '../templates/templates.service';
import { PriceListsService } from '../price-lists/price-lists.service';
import type { AuthUser } from '../common/decorators';
import { Col, readRows, RawRow, templateWorkbook } from './excel-io';
import { KINDS, kindOf, ref, Refs, RefName } from './kinds';

export interface RowResult { row: number; status: 'ok' | 'error' | 'duplicate'; errors: string[]; data: Record<string, string> }
interface Prepared extends RowResult { apply?: (tx: Prisma.TransactionClient, actor: AuthUser) => Promise<unknown> }
export interface Preview { fileName: string; rows: Prepared[]; ignoredColumns: string[] }

const bad = (m: string | object) => new BadRequestException(m);

/** Pull readable messages out of a validation exception; anything unexpected is re-thrown. */
export function messages(e: unknown): string[] {
  if (e instanceof BadRequestException) {
    const m = (e.getResponse() as { message?: string | string[] })?.message ?? e.message;
    return Array.isArray(m) ? m : [String(m)];
  }
  throw e;
}

const TEMPLATE_COLS: Col[] = [
  { key: 'code', header: 'Template Code', required: true, help: 'Rows with the same code form one template.', example: 'METAL-CHAIR' },
  { key: 'name', header: 'Template Name', help: 'Needed on the first row of each template.', example: 'Metal Chair General' },
  { key: 'typeCode', header: 'Type Code', help: 'Needed on the first row of each template.', example: 'CHAIRS' },
  { key: 'wastage', header: 'Wastage %', help: 'Template default wastage (first row). Blank = 0.', example: '2' },
  { key: 'gst', header: 'GST %', help: 'Template GST (first row). Blank = 0.', example: '18' },
  { key: 'markup', header: 'Markup %', help: 'Template markup (first row). Blank = 0.', example: '25' },
  { key: 'description', header: 'Description', help: 'Optional (first row).' },
  { key: 'lineType', header: 'Line Type', required: true, help: 'MATERIAL, LABOUR or EXPENSE.', example: 'MATERIAL' },
  { key: 'groupCode', header: 'Group Code', help: 'Item group (required for MATERIAL and LABOUR; optional for EXPENSE = whole product).', example: 'METAL' },
  { key: 'categoryCode', header: 'Category Code', help: 'MATERIAL lines only.', example: 'METAL-FRAME' },
  { key: 'lineCode', header: 'Item / Labour / Expense Code', required: true, help: 'Code of the item (MATERIAL), labour (LABOUR) or expense (EXPENSE).', example: 'MPM' },
  { key: 'quantity', header: 'Quantity', help: 'MATERIAL / LABOUR quantity (LABOUR blank = 1).', example: '20.94' },
  { key: 'unit', header: 'Unit', help: 'Unit symbol (MATERIAL blank = the item\'s base unit; LABOUR optional).', example: 'KG' },
  { key: 'lineWastage', header: 'Line Wastage %', help: 'MATERIAL only, optional.' },
  { key: 'rate', header: 'Rate Override', help: 'LABOUR only: overrides the labour master rate.' },
  { key: 'method', header: 'Expense Method', help: 'EXPENSE only: FIXED, PERCENTAGE or QUANTITY_BASED (blank = master default).' },
  { key: 'value', header: 'Expense Value', help: 'EXPENSE only (blank = master default).' },
  { key: 'notes', header: 'Notes', help: 'MATERIAL only, optional.' },
];

const PRICELIST_COLS: Col[] = [
  { key: 'name', header: 'Price List Name', required: true, help: 'Rows with the same name form one new draft price list.', example: 'Retail 2026' },
  { key: 'date', header: 'Effective Date', required: true, help: 'YYYY-MM-DD (first row).', example: '2026-04-01' },
  { key: 'costBase', header: 'Cost Base', help: 'BASIC_COST or TOTAL_COST (first row, blank = BASIC_COST).', example: 'BASIC_COST' },
  { key: 'gst', header: 'GST Treatment', help: 'EXCLUSIVE, INCLUSIVE or NONE (first row, blank = EXCLUSIVE).', example: 'EXCLUSIVE' },
  { key: 'roundTo', header: 'Round To', help: 'Optional nearest multiple (first row).' },
  { key: 'costing', header: 'Costing Number', required: true, help: 'Number of an APPROVED costing.', example: 'COST-2026-0001' },
  { key: 'profitMethod', header: 'Profit Method', required: true, help: 'PERCENT or FIXED.', example: 'PERCENT' },
  { key: 'profitValue', header: 'Profit Value', required: true, help: 'Percentage or amount.', example: '20' },
  { key: 'discountPercent', header: 'Discount %', help: 'Optional.' },
  { key: 'discountAmount', header: 'Discount Amount', help: 'Optional (not together with Discount %).' },
  { key: 'minPrice', header: 'Min Price', help: 'Optional.' },
  { key: 'maxPrice', header: 'Max Price', help: 'Optional.' },
  { key: 'notes', header: 'Notes', help: 'Optional.' },
];

interface Special { kind: string; label: string; module: string; columns: Col[]; sheet: string; notes: string[] }
export const SPECIAL: Special[] = [
  { kind: 'templates', label: 'Templates', module: 'templates', columns: TEMPLATE_COLS, sheet: 'Template Lines', notes: ['One row per template line: put the template details (name, type, wastage, GST, markup) on its first row.', 'Import Types, Groups, Categories, Items, Labour and Expenses first.', 'Each template is checked as a whole; if any of its lines has a problem, the whole template is rejected.'] },
  { kind: 'price-lists', label: 'Price lists', module: 'price_lists', columns: PRICELIST_COLS, sheet: 'Price List Items', notes: ['One row per product; rows with the same Price List Name form one new DRAFT price list.', 'Only approved costings can be priced.', 'Each price list is created in its own transaction.'] },
];

@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly masters: MasterService,
    private readonly templates: TemplatesService,
    private readonly priceLists: PriceListsService,
  ) {}

  /** Importable kinds for the screens the user may use. */
  kinds(actor: AuthUser) {
    const allowed = actor.permissions.has('data_management:import');
    const all = [
      ...KINDS.map((k) => ({ kind: k.kind, label: k.label, module: k.module, columns: k.columns, notes: k.notes ?? [] })),
      ...SPECIAL.map((k) => ({ kind: k.kind, label: k.label, module: k.module, columns: k.columns, notes: k.notes })),
    ];
    return all.filter((k) => allowed && actor.permissions.has(`${k.module}:create`)).map((k) => ({
      kind: k.kind, label: k.label, notes: k.notes, columns: k.columns.map((c) => ({ header: c.header, required: !!c.required, help: c.help, example: c.example ?? '' })),
    }));
  }

  private def(actor: AuthUser, kind: string) {
    const master = kindOf(kind);
    const special = SPECIAL.find((s) => s.kind === kind);
    const module = master?.module ?? special?.module;
    if (!module) throw new NotFoundException('Unknown import type');
    if (!actor.permissions.has('data_management:import') || !actor.permissions.has(`${module}:create`)) throw new ForbiddenException(`Importing ${master?.label ?? special!.label} needs the Data Management import and ${module} create permissions`);
    return { master, special };
  }

  async template(actor: AuthUser, kind: string) {
    const { master, special } = this.def(actor, kind);
    if (master) return templateWorkbook(master.label, master.columns, master.notes, master.label);
    return templateWorkbook(special!.label, special!.columns, special!.notes, special!.sheet);
  }

  // ───────── shared lookups ─────────

  private async loadRefs(needs: RefName[]): Promise<Refs> {
    const map = <T extends { id: string }>(rows: T[], key: (r: T) => string) => new Map(rows.map((r) => [key(r).toLowerCase(), r]));
    const w = { deletedAt: null };
    const [types, groups, categories, units, suppliers] = await Promise.all([
      needs.includes('types') ? this.prisma.type.findMany({ where: w, select: { id: true, code: true } }) : [],
      needs.includes('groups') ? this.prisma.itemGroup.findMany({ where: w, select: { id: true, code: true, typeId: true } }) : [],
      needs.includes('categories') ? this.prisma.itemCategory.findMany({ where: w, select: { id: true, code: true, groupId: true } }) : [],
      needs.includes('units') ? this.prisma.unit.findMany({ where: w, select: { id: true, symbol: true } }) : [],
      needs.includes('suppliers') ? this.prisma.supplier.findMany({ where: w, select: { id: true, code: true } }) : [],
    ]);
    return {
      types: map(types, (r) => r.code), groups: map(groups, (r) => r.code), categories: map(categories, (r) => r.code),
      units: map(units, (r) => r.symbol), suppliers: map(suppliers, (r) => r.code),
    };
  }

  // ───────── masters ─────────

  private async previewMaster(actor: AuthUser, kind: string, file: Express.Multer.File | undefined): Promise<Preview> {
    const k = kindOf(kind)!;
    const { fileName, rows, ignored } = await readRows(file, k.columns);
    const refs = await this.loadRefs(k.needs);
    const existing = new Set((await (this.prisma as any)[k.cfg.model].findMany({ where: { deletedAt: null }, select: { [k.naturalKey]: true } })).map((r: any) => String(r[k.naturalKey]).toLowerCase()));
    // items also need codes of the categories' groups to line up; the master's own validate() enforces the hierarchy
    const seen = new Set<string>();
    const out: Prepared[] = [];
    for (const { row, raw } of rows) {
      const err: string[] = [];
      const payload = k.build(raw, refs, err);
      const key = String(raw[k.naturalKey] ?? '').toLowerCase();
      let dup = false;
      if (key && existing.has(key)) { dup = true; err.push(`${k.naturalKey === 'code' ? 'Code' : 'Symbol'} "${raw[k.naturalKey]}" already exists`); }
      else if (key && seen.has(key)) { dup = true; err.push(`${k.naturalKey === 'code' ? 'Code' : 'Symbol'} "${raw[k.naturalKey]}" appears more than once in this file`); }
      if (key) seen.add(key);
      let prepared: Awaited<ReturnType<MasterService['prepareCreate']>> | undefined;
      const problems = err.filter((e) => !/already exists|more than once/.test(e));
      if (!problems.length) { try { prepared = await this.masters.prepareCreate(k.cfg, payload); } catch (e) { err.push(...messages(e)); } }
      const bothKinds = err.some((e) => !/already exists|more than once/.test(e));
      out.push({
        row, data: raw, errors: err, status: bothKinds ? 'error' : dup ? 'duplicate' : 'ok',
        apply: !err.length && prepared ? (tx, a) => this.masters.insertPrepared(k.cfg, tx, a, prepared!) : undefined,
      });
    }
    return { fileName, rows: out, ignoredColumns: ignored };
  }

  // ───────── templates ─────────

  private async previewTemplates(actor: AuthUser, file: Express.Multer.File | undefined): Promise<Preview> {
    const { fileName, rows, ignored } = await readRows(file, TEMPLATE_COLS, 'Template Lines');
    const w = { deletedAt: null };
    const [refs, items, labour, expenses, existing] = await Promise.all([
      this.loadRefs(['types', 'groups', 'categories', 'units']),
      this.prisma.item.findMany({ where: w, select: { id: true, code: true, unitId: true } }),
      this.prisma.labour.findMany({ where: w, select: { id: true, code: true } }),
      this.prisma.expense.findMany({ where: w, select: { id: true, code: true } }),
      this.prisma.template.findMany({ where: w, select: { code: true } }),
    ]);
    const lower = <T extends { code: string }>(r: T[]) => new Map(r.map((x) => [x.code.toLowerCase(), x]));
    const I = lower(items), L = lower(labour), E = lower(expenses);
    const existingCodes = new Set(existing.map((t) => t.code.toLowerCase()));

    const byTemplate = new Map<string, RawRow[]>();
    for (const r of rows) {
      const key = r.raw.code.toLowerCase();
      byTemplate.set(key, [...(byTemplate.get(key) ?? []), r]);
    }

    const results = new Map<number, Prepared>();
    for (const [key, trows] of byTemplate) {
      const head = (f: string) => trows.map((r) => r.raw[f]).find((v) => v !== '') ?? '';
      const rowErrors = new Map<number, string[]>(trows.map((r) => [r.row, []]));
      const fail = (row: number, m: string) => rowErrors.get(row)!.push(m);
      const first = trows[0];
      const type = ref(refs.types, head('typeCode'), 'Type code', rowErrors.get(first.row)!);
      const groups = new Map<string, { groupId: string; categories: Map<string, { categoryId: string; items: any[] }>; labour: any[] }>();
      const expenseLines: any[] = [];
      const grp = (r: RawRow) => {
        const g = ref(refs.groups, r.raw.groupCode, 'Group code', rowErrors.get(r.row)!);
        if (!g) return undefined;
        if (!groups.has(g.id)) groups.set(g.id, { groupId: g.id, categories: new Map(), labour: [] });
        return groups.get(g.id)!;
      };
      for (const r of trows) {
        const err = rowErrors.get(r.row)!;
        const t = r.raw.lineType.toUpperCase();
        if (t === 'MATERIAL') {
          const g = grp(r);
          const cat = ref(refs.categories, r.raw.categoryCode, 'Category code', err);
          const item = ref(I, r.raw.lineCode, 'Item code', err);
          const unit = r.raw.unit ? ref(refs.units, r.raw.unit, 'Unit symbol', err) : item ? { id: item.unitId } : undefined;
          if (g && cat && item && unit) {
            if (!g.categories.has(cat.id)) g.categories.set(cat.id, { categoryId: cat.id, items: [] });
            g.categories.get(cat.id)!.items.push({ itemId: item.id, quantity: r.raw.quantity, unitId: unit.id, wastagePercent: r.raw.lineWastage, notes: r.raw.notes });
          }
        } else if (t === 'LABOUR') {
          const g = grp(r);
          const lab = ref(L, r.raw.lineCode, 'Labour code', err);
          const unit = r.raw.unit ? ref(refs.units, r.raw.unit, 'Unit symbol', err) : undefined;
          if (g && lab) g.labour.push({ labourId: lab.id, quantity: r.raw.quantity || '1', unitId: unit?.id ?? '', rate: r.raw.rate });
        } else if (t === 'EXPENSE') {
          const exp = ref(E, r.raw.lineCode, 'Expense code', err);
          const g = r.raw.groupCode ? ref(refs.groups, r.raw.groupCode, 'Group code', err) : undefined;
          if (exp) expenseLines.push({ expenseId: exp.id, groupId: g?.id ?? '', calculationMethod: r.raw.method.toUpperCase().replace(/ /g, '_'), value: r.raw.value });
        } else fail(r.row, `Line Type must be MATERIAL, LABOUR or EXPENSE (got "${r.raw.lineType}")`);
      }
      // expenses may name a group that has no material / labour lines
      for (const e of expenseLines) if (e.groupId && !groups.has(e.groupId)) groups.set(e.groupId, { groupId: e.groupId, categories: new Map(), labour: [] });

      const payload = {
        name: head('name'), code: first.raw.code, typeId: type?.id ?? '', description: head('description'), wastagePercent: head('wastage') || '0', gstPercent: head('gst') || '0', markupPercent: head('markup') || '0',
        status: 'ACTIVE',
        groups: [...groups.values()].map((g) => ({ groupId: g.groupId, categories: [...g.categories.values()], labour: g.labour })),
        expenses: expenseLines,
      };
      let parsed: TemplateInput | undefined;
      const flat = [...rowErrors.values()].some((e) => e.length);
      if (!flat) {
        const res = templateSchema.safeParse(payload);
        if (!res.success) res.error.issues.forEach((i) => fail(first.row, `${i.path.join('.') || 'template'}: ${i.message}`));
        else {
          parsed = res.data as TemplateInput;
          try { await this.templates.validateTree(this.prisma, parsed); } catch (e) { messages(e).forEach((m) => fail(first.row, m)); parsed = undefined; }
        }
      }
      const isDup = existingCodes.has(key);
      if (isDup) fail(first.row, `Template code "${first.raw.code}" already exists`);
      const hasProblem = [...rowErrors.values()].some((e) => e.length);
      for (const r of trows) {
        const own = rowErrors.get(r.row)!;
        const errors = own.length ? own : hasProblem ? [`Another line of template "${first.raw.code}" has a problem, so the whole template is rejected`] : [];
        results.set(r.row, {
          row: r.row, data: r.raw, errors, status: errors.length ? (isDup && !own.some((m) => !/already exists/.test(m)) ? 'duplicate' : 'error') : 'ok',
          apply: !hasProblem && parsed && r.row === first.row ? (tx, a) => this.templates.createWithin(tx, a, parsed!) : !hasProblem && parsed ? async () => undefined : undefined,
        });
      }
    }
    return { fileName, rows: rows.map((r) => results.get(r.row)!), ignoredColumns: ignored };
  }

  // ───────── price lists ─────────

  private async previewPriceLists(actor: AuthUser, file: Express.Multer.File | undefined): Promise<Preview> {
    const { fileName, rows, ignored } = await readRows(file, PRICELIST_COLS, 'Price List Items');
    const numbers = [...new Set(rows.map((r) => r.raw.costing).filter(Boolean))];
    const costings = numbers.length ? await this.prisma.costing.findMany({ where: { costingNumber: { in: numbers }, deletedAt: null }, select: { id: true, costingNumber: true } }) : [];
    const C = new Map(costings.map((c) => [c.costingNumber.toLowerCase(), c.id]));

    const byList = new Map<string, RawRow[]>();
    for (const r of rows) byList.set(r.raw.name.toLowerCase(), [...(byList.get(r.raw.name.toLowerCase()) ?? []), r]);

    const results = new Map<number, Prepared>();
    for (const trows of byList.values()) {
      const head = (f: string) => trows.map((r) => r.raw[f]).find((v) => v !== '') ?? '';
      const errs = new Map<number, string[]>(trows.map((r) => [r.row, []]));
      const items = trows.flatMap((r) => {
        const id = C.get(r.raw.costing.toLowerCase());
        if (!id) { errs.get(r.row)!.push(`Unknown costing number "${r.raw.costing}"`); return []; }
        return [{ costingId: id, profitMethod: r.raw.profitMethod.toUpperCase(), profitValue: r.raw.profitValue, discountPercent: r.raw.discountPercent, discountAmount: r.raw.discountAmount, minPrice: r.raw.minPrice, maxPrice: r.raw.maxPrice, notes: r.raw.notes }];
      });
      const payload = {
        name: trows[0].raw.name, effectiveDate: head('date'), costBase: (head('costBase') || 'BASIC_COST').toUpperCase(), gstTreatment: (head('gst') || 'EXCLUSIVE').toUpperCase(), roundTo: head('roundTo'),
        defaultProfitMethod: items[0]?.profitMethod === 'FIXED' ? 'FIXED' : 'PERCENT', defaultProfitValue: items[0]?.profitValue || '0', items,
      };
      if (![...errs.values()].some((e) => e.length)) {
        const parsed = priceListSchema.safeParse(payload);
        if (!parsed.success) parsed.error.issues.forEach((i) => errs.get(trows[0].row)!.push(`${i.path.join('.') || 'price list'}: ${i.message}`));
        else { try { await this.priceLists.preview(payload); } catch (e) { messages(e).forEach((m) => errs.get(trows[0].row)!.push(m)); } }
      }
      const problem = [...errs.values()].some((e) => e.length);
      trows.forEach((r, i) => {
        const own = errs.get(r.row)!;
        const errors = own.length ? own : problem ? [`Another row of price list "${trows[0].raw.name}" has a problem, so the whole list is rejected`] : [];
        results.set(r.row, { row: r.row, data: r.raw, errors, status: errors.length ? 'error' : 'ok', apply: !problem && i === 0 ? async (_tx, a) => this.priceLists.create(a, payload) : !problem ? async () => undefined : undefined });
      });
    }
    return { fileName, rows: rows.map((r) => results.get(r.row)!), ignoredColumns: ignored };
  }

  // ───────── public operations ─────────

  async preview(actor: AuthUser, kind: string, file: Express.Multer.File | undefined) {
    const { master, special } = this.def(actor, kind);
    const p = master ? await this.previewMaster(actor, kind, file) : special!.kind === 'templates' ? await this.previewTemplates(actor, file) : await this.previewPriceLists(actor, file);
    return this.summarise(p);
  }

  private summarise(p: Preview) {
    return {
      fileName: p.fileName, total: p.rows.length, valid: p.rows.filter((r) => r.status === 'ok').length, invalid: p.rows.filter((r) => r.status === 'error').length,
      duplicates: p.rows.filter((r) => r.status === 'duplicate').length, ignoredColumns: p.ignoredColumns,
      rows: p.rows.map(({ apply: _a, ...r }) => r),
    };
  }

  /** Re-validates the file, then imports. Nothing is imported silently: invalid rows block the import unless the user chose to skip them. */
  async confirm(actor: AuthUser, kind: string, file: Express.Multer.File | undefined, skipInvalid: boolean) {
    const { master, special } = this.def(actor, kind);
    const p = master ? await this.previewMaster(actor, kind, file) : special!.kind === 'templates' ? await this.previewTemplates(actor, file) : await this.previewPriceLists(actor, file);
    const good = p.rows.filter((r) => r.status === 'ok');
    const rest = p.rows.filter((r) => r.status !== 'ok');
    if (rest.length && !skipInvalid) throw bad({ message: `${rest.length} row(s) are invalid or duplicated; nothing was imported. Fix the file, or choose to skip them.`, summary: this.summarise(p) });
    if (!good.length) throw bad('There are no valid rows to import');

    if (master) {
      await this.prisma.$transaction(async (tx) => { for (const r of good) await r.apply!(tx, actor); }, { timeout: 120_000 });
    } else if (special!.kind === 'templates') {
      await this.prisma.$transaction(async (tx) => { for (const r of good) await r.apply?.(tx, actor); }, { timeout: 120_000 });
    } else {
      for (const r of good) await r.apply?.(this.prisma, actor); // each price list is created in its own transaction
    }
    // records created: rows for masters, distinct templates / price lists otherwise
    const records = master ? good.length : new Set(good.map((r) => (special!.kind === 'templates' ? r.data.code : r.data.name).toLowerCase())).size;
    const label = master?.label ?? special!.label;
    const rec = await this.prisma.importHistory.create({
      data: { kind, fileName: p.fileName, totalRows: p.rows.length, successRows: good.length, failedRows: rest.length, errors: rest.map((r) => ({ row: r.row, errors: r.errors })) as never, createdBy: actor.id },
    });
    await this.audit.log({ userId: actor.id, action: 'import', entity: label, entityId: rec.id, metadata: { kind, rows: good.length, skipped: rest.length } });
    return { importId: rec.id, imported: good.length, skipped: rest.length, records };
  }

  async history(kind?: string) {
    const rows = await this.prisma.importHistory.findMany({ where: kind ? { kind } : {}, orderBy: { createdAt: 'desc' }, take: 100 });
    const ids = [...new Set(rows.map((r) => r.createdBy).filter((x): x is string => !!x))];
    const users = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
    const names = new Map(users.map((u) => [u.id, u.name]));
    return rows.map((r) => ({ ...r, createdByName: r.createdBy ? (names.get(r.createdBy) ?? null) : null }));
  }
}
