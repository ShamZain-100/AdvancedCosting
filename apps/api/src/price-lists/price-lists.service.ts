import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { CalcRules, calculatePrice, costForPricing, PriceInputError, PriceResult } from '@costing/costing-engine';
import {
  addToPriceListSchema, generatePriceListSchema, priceListSchema, priceListStatusSchema, type PriceListInput,
} from '@costing/validators';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { parseOrThrow } from '../masters/master.service';
import { CostingSettingsService } from '../costings/costing-settings.service';
import { ImagesService } from '../images/images.service';
import { NumberingService } from '../settings/numbering.service';
import type { AuthUser } from '../common/decorators';

type Tx = Prisma.TransactionClient;
type ItemInput = PriceListInput['items'][number];
const bad = (m: string) => new BadRequestException(m);
const s = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? undefined : v.toString());

interface CostingFigures {
  id: string; costingNumber: string; productName: string; productCode: string | null; version: number;
  basicCost: { toString(): string }; totalCostInclGst: { toString(): string }; gstPercent: { toString(): string };
  gstAmount: { toString(): string }; extraAmount: { toString(): string }; quantity: { toString(): string };
}

/** Lists priced before prices became per unit hold the cost of the costing's whole quantity; they must be repriced before use. */
export const wholeBatchPrice = (item: { pricedPerUnit?: boolean }, costing: { quantity?: { toString(): string } | null }) =>
  item.pricedPerUnit === false && Number(costing.quantity?.toString() ?? 1) !== 1;

@Injectable()
export class PriceListsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly settings: CostingSettingsService, private readonly images: ImagesService, private readonly numbering: NumberingService) {}

  // ───────── calculation ─────────

  /** Only approved (frozen) costings can be priced. */
  private async approvedCostings(db: Tx | PrismaService, ids: string[]) {
    const rows = await db.costing.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, costingNumber: true, productName: true, productCode: true, version: true, status: true, basicCost: true, totalCostInclGst: true, gstPercent: true, gstAmount: true, extraAmount: true, quantity: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length) throw bad('One or more selected costings do not exist');
    const notApproved = rows.filter((r) => r.status !== 'APPROVED');
    if (notApproved.length) throw bad(`Only approved costings can be priced. Not approved: ${notApproved.map((r) => r.costingNumber).join(', ')}`);
    return byId as Map<string, CostingFigures>;
  }

  /** Cost of one unit of the product. A price list quotes one unit, whatever batch size the costing was made for. */
  private unitCost(list: Pick<PriceListInput, 'gstTreatment'>, c: CostingFigures) {
    return costForPricing({
      basicCost: c.basicCost.toString(), totalCostInclGst: c.totalCostInclGst.toString(), gstAmount: c.gstAmount.toString(), extraAmount: c.extraAmount.toString(), quantity: c.quantity.toString(),
    }, c.gstPercent.toString(), list.gstTreatment !== 'NONE');
  }

  private price(list: Pick<PriceListInput, 'costBase' | 'gstTreatment' | 'roundTo'>, c: CostingFigures, item: Omit<ItemInput, 'costingId'>, rules: CalcRules): PriceResult {
    try {
      const cost = this.unitCost(list, c);
      return calculatePrice({
        basicCost: cost.basicCost, totalCostInclGst: cost.totalCostInclGst, gstPercent: c.gstPercent.toString(),
        costBase: list.costBase, gstTreatment: list.gstTreatment, roundTo: list.roundTo ?? null,
        profitMethod: item.profitMethod, profitValue: item.profitValue,
        discountPercent: item.discountPercent ?? null, discountAmount: item.discountAmount ?? null, minPrice: item.minPrice ?? null, maxPrice: item.maxPrice ?? null,
      }, rules);
    } catch (e) {
      if (e instanceof PriceInputError) throw bad(`${c.productName}: ${e.message}`);
      throw e;
    }
  }

  private rowData(list: Pick<PriceListInput, 'gstTreatment'>, c: CostingFigures, item: ItemInput | Omit<ItemInput, 'costingId'> & { costingId?: string }, r: PriceResult, sortOrder: number) {
    const cost = this.unitCost(list, c);
    return {
      costingId: c.id, costingVersion: c.version, productName: c.productName, productCode: c.productCode, sortOrder, pricedPerUnit: true,
      basicCost: cost.basicCost.toDecimalPlaces(2).toString(), totalCostInclGst: cost.totalCostInclGst.toDecimalPlaces(2).toString(), gstPercent: c.gstPercent.toString(),
      profitMethod: item.profitMethod, profitValue: item.profitValue, discountPercent: item.discountPercent ?? null, discountAmount: item.discountAmount ?? null,
      minPrice: item.minPrice ?? null, maxPrice: item.maxPrice ?? null, notes: item.notes ?? null,
      costBaseAmount: r.costBaseAmount.toString(), profitAmount: r.profitAmount.toString(), listPriceExGst: r.listPriceExGst.toString(), gstAmount: r.gstAmount.toString(),
      listPriceInclGst: r.listPriceInclGst.toString(), sellingPrice: r.sellingPrice.toString(), discountApplied: r.discountAmount.toString(), effectivePrice: r.effectivePrice.toString(),
      effectiveExGst: r.effectiveExGst.toString(), effectiveInclGst: r.effectiveInclGst.toString(),
      effectiveProfit: r.effectiveProfit.toString(), marginPercent: r.marginPercent.toString(), markupPercent: r.markupPercent.toString(), flags: r.flags,
    };
  }

  private async priceAll(db: Tx | PrismaService, input: PriceListInput) {
    const rules = await this.settings.getRules();
    const costings = await this.approvedCostings(db, input.items.map((i) => i.costingId));
    const rows = input.items.map((item, i) => {
      const c = costings.get(item.costingId)!;
      return this.rowData(input, c, item, this.price(input, c, item, rules), i);
    });
    return { rules, rows };
  }

  /** Calculate without saving (drives the editor). */
  async preview(body: unknown) {
    const input = parseOrThrow(priceListSchema, body) as PriceListInput;
    const { rows } = await this.priceAll(this.prisma, input);
    return { items: rows };
  }

  // ───────── persistence ─────────

  private nextNumber(tx: Tx) {
    return this.numbering.next(tx, 'priceList', new Date(), async (n) => (await tx.priceList.count({ where: { number: n } })) > 0);
  }

  private header(input: PriceListInput, rules: CalcRules) {
    return {
      name: input.name, effectiveDate: new Date(`${input.effectiveDate}T00:00:00.000Z`), costBase: input.costBase, gstTreatment: input.gstTreatment,
      roundTo: input.roundTo ?? null, defaultProfitMethod: input.defaultProfitMethod, defaultProfitValue: input.defaultProfitValue,
      defaultDiscountPercent: input.defaultDiscountPercent ?? null, notes: input.notes ?? null, rules: rules as unknown as Prisma.InputJsonValue,
    };
  }

  private async saveNew(actor: AuthUser, input: PriceListInput) {
    const { rules, rows } = await this.priceAll(this.prisma, input);
    const id = await this.prisma.$transaction(async (tx) => {
      const list = await tx.priceList.create({ data: { ...this.header(input, rules), number: await this.nextNumber(tx), createdBy: actor.id, updatedBy: actor.id } });
      if (rows.length) await tx.priceListItem.createMany({ data: rows.map((r) => ({ ...r, priceListId: list.id })) });
      return list.id;
    });
    await this.audit.log({ userId: actor.id, action: 'create', entity: 'PriceList', entityId: id, metadata: { name: input.name, items: rows.length } });
    return this.get(id);
  }

  create(actor: AuthUser, body: unknown) {
    return this.saveNew(actor, parseOrThrow(priceListSchema, body) as PriceListInput);
  }

  /** One price list item per selected approved costing, using the same profit / discount settings. */
  async generate(actor: AuthUser, body: unknown) {
    const g = parseOrThrow(generatePriceListSchema, body) as Record<string, any>;
    const item = { profitMethod: g.profitMethod, profitValue: g.profitValue, discountPercent: g.discountPercent, minPrice: g.minPrice, maxPrice: g.maxPrice };
    return this.saveNew(actor, {
      name: g.name, effectiveDate: g.effectiveDate, costBase: g.costBase, gstTreatment: g.gstTreatment, roundTo: g.roundTo, notes: g.notes,
      defaultProfitMethod: g.profitMethod, defaultProfitValue: g.profitValue, defaultDiscountPercent: g.discountPercent,
      items: [...new Set<string>(g.costingIds)].map((costingId) => ({ costingId, ...item })),
    } as PriceListInput);
  }

  async update(actor: AuthUser, id: string, body: unknown) {
    const list = await this.mustFind(id);
    this.assertDraft(list);
    const input = parseOrThrow(priceListSchema, body) as PriceListInput;
    const { rules, rows } = await this.priceAll(this.prisma, input);
    await this.prisma.$transaction(async (tx) => {
      await tx.priceList.update({ where: { id }, data: { ...this.header(input, rules), updatedBy: actor.id } });
      await tx.priceListItem.deleteMany({ where: { priceListId: id } });
      if (rows.length) await tx.priceListItem.createMany({ data: rows.map((r) => ({ ...r, priceListId: id })) });
    });
    await this.audit.log({ userId: actor.id, action: 'update', entity: 'PriceList', entityId: id, metadata: { items: rows.length } });
    return this.get(id);
  }

  /** Add approved costings using the list's default profit / discount. Costings already in the list are skipped. */
  async addCostings(actor: AuthUser, id: string, body: unknown) {
    const list = await this.mustFind(id);
    this.assertDraft(list);
    const { costingIds } = parseOrThrow(addToPriceListSchema, body) as { costingIds: string[] };
    const existing = new Set((await this.prisma.priceListItem.findMany({ where: { priceListId: id }, select: { costingId: true } })).map((x) => x.costingId));
    const fresh = [...new Set(costingIds)].filter((c) => !existing.has(c));
    if (!fresh.length) return this.get(id);
    const rules = await this.settings.getRules();
    const costings = await this.approvedCostings(this.prisma, fresh);
    const start = existing.size;
    const header = { costBase: list.costBase as never, gstTreatment: list.gstTreatment as 'EXCLUSIVE', roundTo: s(list.roundTo) };
    const rows = fresh.map((cid, i) => {
      const item = { profitMethod: list.defaultProfitMethod as 'PERCENT' | 'FIXED', profitValue: s(list.defaultProfitValue)!, discountPercent: s(list.defaultDiscountPercent) };
      const c = costings.get(cid)!;
      return this.rowData(header, c, item as never, this.price(header, c, item as never, rules), start + i);
    });
    await this.prisma.priceListItem.createMany({ data: rows.map((r) => ({ ...r, priceListId: id })) });
    await this.audit.log({ userId: actor.id, action: 'add_items', entity: 'PriceList', entityId: id, metadata: { added: rows.length } });
    return this.get(id);
  }

  /** Re-read the latest approved costing figures for every item whose costing has changed, and recalculate. */
  async reprice(actor: AuthUser, id: string) {
    const list = await this.mustFind(id);
    this.assertDraft(list);
    const items = await this.prisma.priceListItem.findMany({ where: { priceListId: id }, orderBy: { sortOrder: 'asc' } });
    const costings = await this.approvedCostings(this.prisma, items.map((i) => i.costingId));
    const rules = await this.settings.getRules();
    const header = { costBase: list.costBase as never, gstTreatment: list.gstTreatment as 'EXCLUSIVE', roundTo: s(list.roundTo) };
    let changed = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const it of items) {
        const c = costings.get(it.costingId)!;
        const params = {
          profitMethod: it.profitMethod as 'PERCENT' | 'FIXED', profitValue: it.profitValue.toString(), discountPercent: s(it.discountPercent), discountAmount: s(it.discountAmount),
          minPrice: s(it.minPrice), maxPrice: s(it.maxPrice), notes: it.notes,
        };
        const row = this.rowData(header, c, params as never, this.price(header, c, params as never, rules), it.sortOrder);
        if (row.effectivePrice !== it.effectivePrice.toString() || c.version !== it.costingVersion || !it.pricedPerUnit) changed++;
        await tx.priceListItem.update({ where: { id: it.id }, data: row });
      }
    });
    await this.prisma.reviewFlag.updateMany({ where: { priceListId: id, resolvedAt: null }, data: { resolvedAt: new Date(), resolvedBy: actor.id } });
    await this.audit.log({ userId: actor.id, action: 'reprice', entity: 'PriceList', entityId: id, metadata: { changed } });
    return { ...(await this.get(id)), changed };
  }

  async setStatus(actor: AuthUser, id: string, body: unknown) {
    const { status } = parseOrThrow(priceListStatusSchema, body) as { status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED' };
    const list = await this.mustFind(id);
    if (list.status === status) throw bad(`The price list is already ${status.toLowerCase()}`);
    if (status === 'ACTIVE') {
      const stale = (await this.get(id)).items.filter((i) => i.stale);
      if (stale.length) throw bad(`${stale.length} item(s) are priced from an out-of-date costing. Reprice the list before activating it.`);
      if (!(await this.prisma.priceListItem.count({ where: { priceListId: id } }))) throw bad('Add at least one product before activating the price list');
    }
    await this.prisma.priceList.update({ where: { id }, data: { status, updatedBy: actor.id } });
    await this.audit.log({ userId: actor.id, action: 'set_status', entity: 'PriceList', entityId: id, metadata: { from: list.status, to: status } });
    return { id, status };
  }

  async remove(actor: AuthUser, id: string) {
    const list = await this.mustFind(id);
    if (list.status === 'ACTIVE') throw bad('Archive or revert an active price list to draft before deleting it');
    await this.prisma.priceList.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: actor.id } });
    await this.audit.log({ userId: actor.id, action: 'delete', entity: 'PriceList', entityId: id, metadata: { number: list.number } });
    return { id };
  }

  private assertDraft(l: { status: string }) {
    if (l.status !== 'DRAFT') throw bad('Only draft price lists can be edited. Revert the list to draft first.');
  }

  // ───────── reads ─────────

  async get(id: string) {
    const list = await this.prisma.priceList.findFirst({
      where: { id, deletedAt: null },
      include: { items: { orderBy: { sortOrder: 'asc' }, include: { costing: { select: { costingNumber: true, version: true, status: true, deletedAt: true, quantity: true } } } } },
    });
    if (!list) throw new NotFoundException('Price list not found');
    const imgs = await this.images.mainImages('costing', list.items.map((i) => i.costingId));
    const items = list.items.map(({ costing, ...i }) => {
      const staleReason = costing.deletedAt ? 'Costing deleted' : costing.status !== 'APPROVED' ? 'Costing is no longer approved' : costing.version !== i.costingVersion ? 'Costing changed since pricing'
        : wholeBatchPrice(i, costing) ? 'Priced for the whole batch, not per unit' : null;
      return { ...i, costingNumber: costing.costingNumber, stale: staleReason !== null, staleReason, image: imgs.get(i.costingId) ?? null };
    });
    const reviewFlags = await this.prisma.reviewFlag.findMany({ where: { priceListId: id, resolvedAt: null }, orderBy: { createdAt: 'desc' }, select: { id: true, reason: true, createdAt: true } });
    const { items: _drop, ...head } = list;
    return {
      ...head, reviewFlags,
      payload: {
        name: list.name, effectiveDate: list.effectiveDate.toISOString().slice(0, 10), costBase: list.costBase, gstTreatment: list.gstTreatment, roundTo: s(list.roundTo) ?? '',
        defaultProfitMethod: list.defaultProfitMethod, defaultProfitValue: s(list.defaultProfitValue)!, defaultDiscountPercent: s(list.defaultDiscountPercent) ?? '', notes: list.notes ?? '',
        items: items.map((i) => ({
          costingId: i.costingId, profitMethod: i.profitMethod, profitValue: s(i.profitValue)!, discountPercent: s(i.discountPercent) ?? '', discountAmount: s(i.discountAmount) ?? '',
          minPrice: s(i.minPrice) ?? '', maxPrice: s(i.maxPrice) ?? '', notes: i.notes ?? '',
        })),
      },
      items,
    };
  }

  async list(q: Record<string, string | undefined>) {
    const where: Prisma.PriceListWhereInput = { deletedAt: null };
    if (q.status) where.status = q.status as never;
    if (q.search) where.OR = [{ name: { contains: q.search, mode: 'insensitive' } }, { number: { contains: q.search, mode: 'insensitive' } }];
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 25));
    const [rows, total] = await Promise.all([
      this.prisma.priceList.findMany({ where, orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }], skip: (page - 1) * pageSize, take: pageSize, include: { _count: { select: { items: true } } } }),
      this.prisma.priceList.count({ where }),
    ]);
    return { items: rows.map(({ _count, rules: _r, ...l }) => ({ ...l, itemCount: _count.items })), total, page, pageSize };
  }

  // ───────── export ─────────

  async exportExcel(id: string): Promise<Buffer> {
    const l = await this.get(id);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Price List');
    ws.addRow([`${l.name}  (${l.number})`]).font = { bold: true, size: 14 };
    ws.addRow([`Effective ${l.effectiveDate.toISOString().slice(0, 10)} · profit on ${l.costBase === 'BASIC_COST' ? 'cost before GST' : 'cost incl. GST'} · prices ${l.gstTreatment === 'EXCLUSIVE' ? 'exclude GST' : l.gstTreatment === 'INCLUSIVE' ? 'include GST' : 'have no GST'} · status ${l.status}`]);
    ws.addRow([]);
    const head = ws.addRow(['SL', 'Product code', 'Product', 'Costing', 'Cost base', 'Profit', 'Profit amount', 'Price excl. GST', 'GST', 'Price incl. GST', 'List price', 'Discount', 'Selling price', 'Selling price incl. GST', 'Margin %', 'Notes']);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    l.items.forEach((i, n) => ws.addRow([
      n + 1, i.productCode ?? '', i.productName, i.costingNumber, Number(i.costBaseAmount), i.profitMethod === 'PERCENT' ? `${Number(i.profitValue)}%` : Number(i.profitValue),
      Number(i.profitAmount), Number(i.listPriceExGst), Number(i.gstAmount), Number(i.listPriceInclGst), Number(i.sellingPrice), Number(i.discountApplied), Number(i.effectivePrice), Number(i.effectiveInclGst),
      Number(i.marginPercent) / 100, [i.notes, ...i.flags.map((f) => f.replace('_', ' ').toLowerCase()), i.stale ? `STALE: ${i.staleReason}` : ''].filter(Boolean).join('; '),
    ]));
    [5, 7, 8, 9, 10, 11, 12, 13, 14].forEach((c) => (ws.getColumn(c).numFmt = '#,##0.00'));
    ws.getColumn(15).numFmt = '0.00%';
    [5, 14, 36, 16, 14, 10, 14, 16, 12, 16, 14, 12, 16, 18, 10, 40].forEach((w, i) => (ws.getColumn(i + 1).width = w));
    ws.views = [{ state: 'frozen', ySplit: 4 }];
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: 16 } };
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  private async mustFind(id: string) {
    const l = await this.prisma.priceList.findFirst({ where: { id, deletedAt: null } });
    if (!l) throw new NotFoundException('Price list not found');
    return l;
  }
}
