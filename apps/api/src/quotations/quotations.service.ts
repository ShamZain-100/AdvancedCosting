import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import * as ExcelJS from 'exceljs';
import { calculatePrice, calculateQuotation, CalcRules, costForPricing, d, PriceInputError, QuotationInputError, QuotationResult } from '@costing/costing-engine';
import { wholeBatchPrice } from '../price-lists/price-lists.service';
import { quotationActionSchema, quotationSchema, quotationShareSchema, type QuotationPayload } from '@costing/validators';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { parseOrThrow } from '../masters/master.service';
import { CostingSettingsService } from '../costings/costing-settings.service';
import { ImagesService } from '../images/images.service';
import { CompanyService } from '../company/company.service';
import { NumberingService } from '../settings/numbering.service';
import { SettingsService } from '../settings/settings.service';
import type { AuthUser } from '../common/decorators';

type Tx = Prisma.TransactionClient;
type Item = QuotationPayload['items'][number];
const bad = (m: string) => new BadRequestException(m);
const s = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? undefined : v.toString());
const sha256 = (x: string) => createHash('sha256').update(x).digest('hex');
const today = () => new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
const addDays = (dt: Date, n: number) => new Date(dt.getTime() + n * 86_400_000);
const isoDay = (dt: Date) => dt.toISOString().slice(0, 10);

export type QuotationAction = 'submit' | 'withdraw' | 'approve' | 'reject' | 'send' | 'accept' | 'decline' | 'convert' | 'revise';
const FLOW: Record<QuotationAction, { from: string[]; to: 'DRAFT' | 'PENDING' | 'SENT' | 'APPROVED' | 'REJECTED' | 'CONVERTED'; approver?: boolean; reason?: boolean }> = {
  submit: { from: ['DRAFT'], to: 'PENDING' },
  withdraw: { from: ['PENDING'], to: 'DRAFT' },
  approve: { from: ['PENDING'], to: 'APPROVED', approver: true },
  reject: { from: ['PENDING'], to: 'REJECTED', approver: true, reason: true },
  send: { from: ['DRAFT', 'APPROVED'], to: 'SENT' },
  accept: { from: ['SENT'], to: 'APPROVED' },
  decline: { from: ['SENT'], to: 'REJECTED', reason: true },
  convert: { from: ['APPROVED', 'SENT'], to: 'CONVERTED' },
  revise: { from: ['REJECTED', 'EXPIRED', 'SENT', 'APPROVED'], to: 'DRAFT' },
};

interface Line {
  source: 'MANUAL' | 'COSTING' | 'PRICE_LIST';
  costingId: string | null; costingVersion: number | null; priceListItemId: string | null; profitPercent: string | null;
  productName: string; productCode: string | null; description: string | null; quantity: string; unitId: string | null; unitLabel: string | null;
  unitPrice: string; discountPercent: string | null; discountAmount: string | null; gstPercent: string;
}

@Injectable()
export class QuotationsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly settings: CostingSettingsService, private readonly images: ImagesService, private readonly company: CompanyService, private readonly numbering: NumberingService, private readonly appSettings: SettingsService) {}

  // ───────── pricing the lines ─────────

  private async unitSymbol(db: Tx | PrismaService, unitId: string | null | undefined, label?: string | null) {
    if (!unitId) return { unitId: null, unitLabel: label ?? null };
    const u = await db.unit.findFirst({ where: { id: unitId, deletedAt: null } });
    if (!u) throw bad('Selected unit does not exist');
    return { unitId, unitLabel: u.symbol };
  }

  /** Turn payload lines into priced lines. COSTING / PRICE_LIST sources are priced by the server from frozen data. */
  private async resolveLines(db: Tx | PrismaService, items: Item[], rules: CalcRules): Promise<Line[]> {
    const costingIds = [...new Set(items.flatMap((i) => (i.costingId ? [i.costingId] : [])))];
    const plIds = [...new Set(items.flatMap((i) => (i.priceListItemId ? [i.priceListItemId] : [])))];
    const [costings, plItems] = await Promise.all([
      costingIds.length ? db.costing.findMany({ where: { id: { in: costingIds }, deletedAt: null } }) : [],
      plIds.length ? db.priceListItem.findMany({ where: { id: { in: plIds } }, include: { priceList: true, costing: true } }) : [],
    ]);
    const C = new Map(costings.map((c) => [c.id, c]));
    const P = new Map(plItems.map((p) => [p.id, p]));

    const out: Line[] = [];
    for (const [n, it] of items.entries()) {
      const at = `items.${n}`;
      const common = { description: it.description ?? null, quantity: it.quantity, discountPercent: it.discountPercent ?? null, discountAmount: it.discountAmount ?? null };
      if (it.source === 'MANUAL') {
        const unit = await this.unitSymbol(db, it.unitId, it.unitLabel);
        out.push({ ...common, ...unit, source: 'MANUAL', costingId: it.costingId ?? null, costingVersion: null, priceListItemId: null, profitPercent: null,
          productName: it.productName!, productCode: it.productCode ?? null, unitPrice: it.unitPrice!, gstPercent: it.gstPercent! });
      } else if (it.source === 'COSTING') {
        const c = C.get(it.costingId!);
        if (!c) throw bad(`${at}.costingId: Costing not found`);
        if (c.status !== 'APPROVED') throw bad(`${at}.costingId: ${c.costingNumber} is not approved. Only approved costings can be quoted.`);
        const profit = it.profitPercent ?? c.markupPercent.toString();
        const gst = it.gstPercent ?? c.gstPercent.toString();
        let price;
        try {
          const cost = costForPricing({ basicCost: c.basicCost.toString(), totalCostInclGst: c.totalCostInclGst.toString(), gstAmount: c.gstAmount.toString(), extraAmount: c.extraAmount.toString(), quantity: c.quantity.toString() }, gst);
          price = calculatePrice({ ...cost, gstPercent: gst, costBase: 'BASIC_COST', profitMethod: 'PERCENT', profitValue: profit, gstTreatment: 'EXCLUSIVE' }, rules);
        } catch (e) { if (e instanceof PriceInputError) throw bad(`${at}: ${e.message}`); throw e; }
        const unit = await this.unitSymbol(db, it.unitId ?? c.unitId, it.unitLabel);
        out.push({ ...common, ...unit, source: 'COSTING', costingId: c.id, costingVersion: c.version, priceListItemId: null, profitPercent: profit,
          productName: it.productName ?? c.productName, productCode: it.productCode ?? c.productCode, unitPrice: price.effectivePrice.toString(), gstPercent: gst });
      } else {
        const p = P.get(it.priceListItemId!);
        if (!p) throw bad(`${at}.priceListItemId: Price list item not found`);
        if (p.priceList.status !== 'ACTIVE' || p.priceList.deletedAt) throw bad(`${at}: price list ${p.priceList.number} is not active`);
        if (p.costing.status !== 'APPROVED' || p.costing.version !== p.costingVersion) throw bad(`${at}: ${p.productName} is out of date in price list ${p.priceList.number}. Reprice that list first.`);
        if (wholeBatchPrice(p, p.costing)) throw bad(`${at}: ${p.productName} in price list ${p.priceList.number} is priced for the whole batch. Reprice that list first.`);
        const unit = await this.unitSymbol(db, it.unitId ?? p.costing.unitId, it.unitLabel);
        out.push({ ...common, ...unit, source: 'PRICE_LIST', costingId: p.costingId, costingVersion: p.costingVersion, priceListItemId: p.id, profitPercent: null,
          productName: it.productName ?? p.productName, productCode: it.productCode ?? p.productCode,
          unitPrice: p.effectiveExGst.toString(), gstPercent: p.priceList.gstTreatment === 'NONE' ? '0' : (it.gstPercent ?? p.gstPercent.toString()) });
      }
    }
    return out;
  }

  private compute(lines: Line[], q: Pick<QuotationPayload, 'discountPercent' | 'discountAmount' | 'roundGrandTotal'>, rules: CalcRules): QuotationResult {
    try {
      return calculateQuotation({
        lines: lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discountPercent: l.discountPercent, discountAmount: l.discountAmount, gstPercent: l.gstPercent })),
        discountPercent: q.discountPercent ?? null, discountAmount: q.discountAmount ?? null, roundGrandTotal: q.roundGrandTotal,
      }, rules);
    } catch (e) { if (e instanceof QuotationInputError) throw bad(e.message); throw e; }
  }

  private async prepare(db: Tx | PrismaService, input: QuotationPayload) {
    const rules = await this.settings.getRules();
    if (input.customerId && !(await db.customer.findFirst({ where: { id: input.customerId, deletedAt: null } }))) throw bad('customerId: Customer not found');
    const lines = await this.resolveLines(db, input.items, rules);
    return { rules, lines, result: this.compute(lines, input, rules) };
  }

  async preview(body: unknown) {
    const input = parseOrThrow(quotationSchema, body) as QuotationPayload;
    const { lines, result } = await this.prepare(this.prisma, input);
    return { ...this.totals(result), lines: lines.map((l, i) => this.lineOut(l, result.lines[i])), gstBreakdown: result.gstBreakdown.map((b) => ({ percent: b.percent.toString(), taxable: b.taxable.toString(), gst: b.gst.toString() })) };
  }

  private totals(r: QuotationResult) {
    return {
      subtotal: r.subtotal.toString(), lineDiscountTotal: r.lineDiscountTotal.toString(), headerDiscount: r.headerDiscount.toString(), taxableAmount: r.taxableAmount.toString(),
      gstAmount: r.gstAmount.toString(), roundOff: r.roundOff.toString(), grandTotal: r.grandTotal.toString(),
    };
  }

  private lineOut(l: Line, r: QuotationResult['lines'][number]) {
    return { ...l, gross: r.gross.toString(), lineDiscount: r.lineDiscount.toString(), headerDiscountShare: r.headerDiscountShare.toString(), taxableNet: r.taxableNet.toString(), gstAmount: r.gstAmount.toString(), lineTotal: r.total.toString() };
  }

  // ───────── persistence ─────────

  private nextNumber(tx: Tx) {
    return this.numbering.next(tx, 'quotation', new Date(), async (n) => (await tx.quotation.count({ where: { number: n } })) > 0);
  }

  private header(input: QuotationPayload, rules: CalcRules, r: QuotationResult) {
    const date = new Date(`${input.quotationDate}T00:00:00.000Z`);
    return {
      quotationDate: date, validUntil: addDays(date, input.validityDays), customerId: input.customerId ?? null, customerName: input.customerName,
      customerMobile: input.customerMobile ?? null, customerEmail: input.customerEmail ?? null, customerAddress: input.customerAddress ?? null,
      customerGstin: input.customerGstin ?? null, customerState: input.customerState ?? null, subject: input.subject ?? null, terms: input.terms ?? null, notes: input.notes ?? null,
      discountPercent: input.discountPercent ?? null, discountAmount: input.discountAmount ?? null, roundGrandTotal: input.roundGrandTotal,
      rules: rules as unknown as Prisma.InputJsonValue, ...this.totals(r),
    };
  }

  private itemRows(quotationId: string, lines: Line[], r: QuotationResult) {
    return lines.map((l, i) => ({
      quotationId, sortOrder: i, source: l.source, costingId: l.costingId, costingVersion: l.costingVersion, priceListItemId: l.priceListItemId, profitPercent: l.profitPercent,
      productName: l.productName, productCode: l.productCode, description: l.description, quantity: l.quantity, unitId: l.unitId, unitLabel: l.unitLabel, unitPrice: l.unitPrice,
      discountPercent: l.discountPercent, discountAmount: l.discountAmount, gstPercent: l.gstPercent,
      gross: r.lines[i].gross.toString(), lineDiscount: r.lines[i].lineDiscount.toString(), headerDiscountShare: r.lines[i].headerDiscountShare.toString(),
      taxableNet: r.lines[i].taxableNet.toString(), gstAmount: r.lines[i].gstAmount.toString(), lineTotal: r.lines[i].total.toString(),
    }));
  }

  async create(actor: AuthUser, body: unknown) {
    const input = parseOrThrow(quotationSchema, body) as QuotationPayload;
    const { rules, lines, result } = await this.prepare(this.prisma, input);
    const id = await this.prisma.$transaction(async (tx) => {
      const q = await tx.quotation.create({ data: { ...this.header(input, rules, result), number: await this.nextNumber(tx), preparedById: actor.id, createdBy: actor.id, updatedBy: actor.id } });
      await tx.quotationItem.createMany({ data: this.itemRows(q.id, lines, result) });
      return q.id;
    });
    await this.audit.log({ userId: actor.id, action: 'create', entity: 'Quotation', entityId: id, metadata: { customer: input.customerName, lines: lines.length } });
    return this.get(id);
  }

  async update(actor: AuthUser, id: string, body: unknown) {
    const q = await this.mustFind(id);
    this.assertDraft(q);
    const input = parseOrThrow(quotationSchema, body) as QuotationPayload;
    await this.write(actor, q, input);
    return this.get(id);
  }

  private async write(actor: AuthUser, q: { id: string; version: number }, input: QuotationPayload, note?: string) {
    const { rules, lines, result } = await this.prepare(this.prisma, input);
    await this.prisma.$transaction(async (tx) => {
      await tx.quotation.update({ where: { id: q.id }, data: { ...this.header(input, rules, result), version: q.version + 1, updatedBy: actor.id } });
      await tx.quotationItem.deleteMany({ where: { quotationId: q.id } });
      await tx.quotationItem.createMany({ data: this.itemRows(q.id, lines, result) });
    });
    await this.audit.log({ userId: actor.id, action: note ?? 'update', entity: 'Quotation', entityId: q.id, metadata: { version: q.version + 1 } });
  }

  /** Copy a quotation as a new draft with exactly the same figures (no repricing). */
  async duplicate(actor: AuthUser, id: string) {
    const src = await this.prisma.quotation.findFirst({ where: { id, deletedAt: null }, include: { items: { orderBy: { sortOrder: 'asc' } } } });
    if (!src) throw new NotFoundException('Quotation not found');
    const days = Math.max(1, Math.round((src.validUntil.getTime() - src.quotationDate.getTime()) / 86_400_000));
    const date = today();
    const newId = await this.prisma.$transaction(async (tx) => {
      const q = await tx.quotation.create({
        data: {
          number: await this.nextNumber(tx), status: 'DRAFT', quotationDate: date, validUntil: addDays(date, days),
          customerId: src.customerId, customerName: src.customerName, customerMobile: src.customerMobile, customerEmail: src.customerEmail,
          customerAddress: src.customerAddress, customerGstin: src.customerGstin, customerState: src.customerState,
          subject: src.subject, terms: src.terms, notes: src.notes, discountPercent: src.discountPercent, discountAmount: src.discountAmount,
          roundGrandTotal: src.roundGrandTotal, rules: src.rules as Prisma.InputJsonValue,
          subtotal: src.subtotal, lineDiscountTotal: src.lineDiscountTotal, headerDiscount: src.headerDiscount, taxableAmount: src.taxableAmount,
          gstAmount: src.gstAmount, roundOff: src.roundOff, grandTotal: src.grandTotal,
          preparedById: actor.id, createdBy: actor.id, updatedBy: actor.id,
        },
      });
      await tx.quotationItem.createMany({
        data: src.items.map((it) => ({
          quotationId: q.id, sortOrder: it.sortOrder, source: it.source, costingId: it.costingId, costingVersion: it.costingVersion, priceListItemId: it.priceListItemId,
          profitPercent: it.profitPercent, productName: it.productName, productCode: it.productCode, description: it.description, quantity: it.quantity, unitId: it.unitId,
          unitLabel: it.unitLabel, unitPrice: it.unitPrice, discountPercent: it.discountPercent, discountAmount: it.discountAmount, gstPercent: it.gstPercent,
          gross: it.gross, lineDiscount: it.lineDiscount, headerDiscountShare: it.headerDiscountShare, taxableNet: it.taxableNet, gstAmount: it.gstAmount, lineTotal: it.lineTotal,
        })),
      });
      return q.id;
    });
    await this.audit.log({ userId: actor.id, action: 'duplicate', entity: 'Quotation', entityId: newId, metadata: { from: src.number } });
    return this.get(newId);
  }

  /** Draft only: re-read costing / price list figures for every linked line. */
  async reprice(actor: AuthUser, id: string) {
    const q = await this.mustFind(id);
    this.assertDraft(q);
    const full = await this.get(id);
    await this.write(actor, q, parseOrThrow(quotationSchema, full.payload) as QuotationPayload, 'reprice');
    await this.prisma.reviewFlag.updateMany({ where: { quotationId: id, resolvedAt: null }, data: { resolvedAt: new Date(), resolvedBy: actor.id } });
    return this.get(id);
  }

  async transition(actor: AuthUser, id: string, action: QuotationAction, body: unknown) {
    if (!FLOW[action]) throw bad('Unknown action');
    await this.expireOverdue(true);
    const { reason, reference } = parseOrThrow(quotationActionSchema, body ?? {}) as { reason?: string; reference?: string };
    const q = await this.mustFind(id);
    const rule = FLOW[action];
    if (!rule.from.includes(q.status)) throw bad(`Cannot ${action} a quotation that is ${q.status.toLowerCase()}`);
    const locked = action === 'revise' && (q.status === 'SENT' || q.status === 'APPROVED');
    if ((rule.approver || locked) && !actor.permissions.has('quotations:approve')) throw new ForbiddenException('You need the quotations:approve permission for this action');
    if ((rule.reason || locked) && !reason) throw bad('reason: A reason is required');
    if (action === 'convert' && !reference) throw bad('reference: Enter the order / invoice reference');
    const workflow = (await this.appSettings.get()).approval.quotation;
    if (action === 'send' && workflow.required && q.status === 'DRAFT') throw bad('Settings require a quotation to be approved before it is sent. Submit it for approval first.');
    if (action === 'approve' && !workflow.allowSelfApproval && q.preparedById === actor.id) throw new ForbiddenException('Settings require a quotation to be approved by someone other than the person who prepared it');
    if (action === 'send' || action === 'approve') {
      const stale = (await this.get(id)).items.filter((i) => i.stale);
      if (stale.length) throw bad(`${stale.length} line(s) are priced from a costing that changed (${stale.map((i) => i.productName).join(', ')}). Reprice the quotation first.`);
    }
    const data: Prisma.QuotationUncheckedUpdateInput = { status: rule.to, updatedBy: actor.id };
    if (action === 'send') data.sentAt = new Date();
    if (action === 'approve' || action === 'accept') data.approvedAt = new Date();
    if (action === 'reject' || action === 'decline') data.rejectionReason = reason;
    if (action === 'convert') Object.assign(data, { convertedRef: reference, convertedAt: new Date() });
    if (action === 'revise') Object.assign(data, { version: q.version + 1, sentAt: null, approvedAt: null, rejectionReason: null });
    // a validity date in the past would expire again immediately; renew it when reopening
    if (action === 'revise' && q.validUntil < today()) {
      const days = Math.max(1, Math.round((q.validUntil.getTime() - q.quotationDate.getTime()) / 86_400_000));
      Object.assign(data, { quotationDate: today(), validUntil: addDays(today(), days) });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.quotation.update({ where: { id }, data });
      if (action === 'revise' || action === 'withdraw') await tx.quotationShare.updateMany({ where: { quotationId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      if (action === 'revise') await tx.reviewFlag.updateMany({ where: { quotationId: id, resolvedAt: null }, data: { resolvedAt: new Date(), resolvedBy: actor.id } });
    });
    await this.audit.log({ userId: actor.id, action, entity: 'Quotation', entityId: id, metadata: { from: q.status, to: rule.to, reason: reason ?? null, reference: reference ?? null } });
    return { id, status: rule.to };
  }

  async remove(actor: AuthUser, id: string) {
    const q = await this.mustFind(id);
    if (!['DRAFT', 'REJECTED', 'EXPIRED'].includes(q.status)) throw bad('Only draft, rejected or expired quotations can be deleted');
    await this.prisma.$transaction([
      this.prisma.quotation.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: actor.id } }),
      this.prisma.quotationShare.updateMany({ where: { quotationId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.log({ userId: actor.id, action: 'delete', entity: 'Quotation', entityId: id, metadata: { number: q.number } });
    return { id };
  }

  /** Sent / pending quotations past their validity date become EXPIRED (done lazily on reads). */
  private lastExpiryRun = 0;

  /** Throttled to once per 30 s per process so reading the list does not write on every request; actions force it. */
  async expireOverdue(force = false) {
    if (!force && Date.now() - this.lastExpiryRun < 30_000) return;
    this.lastExpiryRun = Date.now();
    await this.prisma.quotation.updateMany({ where: { status: { in: ['SENT', 'PENDING'] }, validUntil: { lt: today() }, deletedAt: null }, data: { status: 'EXPIRED' } });
  }

  private assertDraft(q: { status: string }) {
    if (q.status !== 'DRAFT') throw bad('Only draft quotations can be edited. Use "Revise" to reopen it (a reason is required for sent or approved quotations).');
  }

  // ───────── sharing ─────────

  /** Create a read-only link for the customer. The token is shown once; only its hash is stored. */
  async createShare(actor: AuthUser, id: string, body: unknown) {
    await this.expireOverdue(true);
    const q = await this.mustFind(id);
    if (!['SENT', 'APPROVED'].includes(q.status)) throw bad('Only sent or approved quotations can be shared');
    const { days } = parseOrThrow(quotationShareSchema, body ?? {}) as { days?: number };
    const expiresAt = days ? addDays(new Date(), days) : addDays(q.validUntil, 1);
    if (expiresAt <= new Date()) throw bad('The quotation validity has already passed');
    const token = randomBytes(32).toString('base64url');
    const share = await this.prisma.quotationShare.create({ data: { quotationId: id, tokenHash: sha256(token), expiresAt, createdBy: actor.id } });
    await this.audit.log({ userId: actor.id, action: 'share', entity: 'Quotation', entityId: id, metadata: { shareId: share.id, expiresAt: expiresAt.toISOString() } });
    return { id: share.id, token, expiresAt };
  }

  async listShares(id: string) {
    await this.mustFind(id);
    return this.prisma.quotationShare.findMany({ where: { quotationId: id }, orderBy: { createdAt: 'desc' }, select: { id: true, createdAt: true, expiresAt: true, revokedAt: true } });
  }

  async revokeShare(actor: AuthUser, id: string, shareId: string) {
    const r = await this.prisma.quotationShare.updateMany({ where: { id: shareId, quotationId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!r.count) throw new NotFoundException('Share link not found');
    await this.audit.log({ userId: actor.id, action: 'revoke_share', entity: 'Quotation', entityId: id, metadata: { shareId } });
    return { id: shareId };
  }

  /** What the customer sees: no internal costs, no profit, no preparer email. */
  async publicView(token: string) {
    const share = await this.prisma.quotationShare.findUnique({ where: { tokenHash: sha256(token) } });
    if (!share || share.revokedAt || share.expiresAt < new Date()) throw new NotFoundException('This link is invalid or has expired');
    await this.expireOverdue();
    const q = await this.prisma.quotation.findFirst({
      where: { id: share.quotationId, deletedAt: null }, include: { items: { orderBy: { sortOrder: 'asc' } }, preparedBy: { select: { name: true } } },
    });
    if (!q || !['SENT', 'APPROVED', 'CONVERTED', 'EXPIRED'].includes(q.status)) throw new NotFoundException('This link is invalid or has expired');
    const imgs = await this.images.mainImages('costing', q.items.map((i) => i.costingId).filter((x): x is string => !!x));
    const breakdown = this.storedGstBreakdown(q);
    return {
      company: await this.company.get(),
      number: q.number, status: q.status, quotationDate: isoDay(q.quotationDate), validUntil: isoDay(q.validUntil), subject: q.subject, preparedBy: q.preparedBy.name,
      customer: { name: q.customerName, address: q.customerAddress, gstin: q.customerGstin, state: q.customerState },
      items: q.items.map((i) => ({
        productName: i.productName, productCode: i.productCode, description: i.description, quantity: i.quantity.toString(), unit: i.unitLabel, unitPrice: i.unitPrice.toString(),
        discount: i.lineDiscount.toString(), gstPercent: i.gstPercent.toString(), gstAmount: i.gstAmount.toString(), total: i.lineTotal.toString(),
        image: i.costingId ? (imgs.get(i.costingId)?.url ?? null) : null,
      })),
      totals: { subtotal: q.subtotal.toString(), discount: d(q.lineDiscountTotal.toString()).plus(q.headerDiscount.toString()).toString(), taxableAmount: q.taxableAmount.toString(), gstAmount: q.gstAmount.toString(), roundOff: q.roundOff.toString(), grandTotal: q.grandTotal.toString() },
      gstBreakdown: breakdown, terms: q.terms, notes: q.notes,
    };
  }

  async exportExcel(id: string): Promise<Buffer> {
    const q = await this.get(id);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Quotation');
    ws.addRow([`Quotation ${q.number}`]).font = { bold: true, size: 14 };
    ws.addRow([`Date ${isoDay(q.quotationDate)} · valid until ${isoDay(q.validUntil)} · status ${q.status}`]);
    ws.addRow([`Customer: ${q.customerName}${q.customerGstin ? ` · GSTIN ${q.customerGstin}` : ''}${q.customerAddress ? ` · ${q.customerAddress}` : ''}`]);
    ws.addRow([]);
    const head = ws.addRow(['SL', 'Code', 'Product', 'Description', 'Qty', 'Unit', 'Unit price', 'Discount', 'Taxable', 'GST %', 'GST', 'Total']);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    q.items.forEach((i, n) => ws.addRow([
      n + 1, i.productCode ?? '', i.productName, i.description ?? '', Number(i.quantity), i.unitLabel ?? '', Number(i.unitPrice),
      Number(i.lineDiscount) + Number(i.headerDiscountShare), Number(i.taxableNet), Number(i.gstPercent) / 100, Number(i.gstAmount), Number(i.lineTotal),
    ]));
    const first = 6, last = 5 + q.items.length;
    const total = ws.addRow(['', '', '', '', '', '', '', '', { formula: `SUM(I${first}:I${last})` }, '', { formula: `SUM(K${first}:K${last})` }, { formula: `SUM(L${first}:L${last})` }]);
    total.font = { bold: true };
    if (Number(q.roundOff) !== 0) ws.addRow(['', '', '', '', '', '', '', '', '', '', 'Round off', Number(q.roundOff)]);
    ws.addRow(['', '', '', '', '', '', '', '', '', '', 'Grand total', Number(q.grandTotal)]).font = { bold: true };
    [7, 8, 9, 11, 12].forEach((c) => (ws.getColumn(c).numFmt = '#,##0.00'));
    ws.getColumn(10).numFmt = '0.##%';
    [5, 12, 34, 36, 9, 8, 14, 12, 14, 8, 12, 14].forEach((w, i) => (ws.getColumn(i + 1).width = w));
    ws.views = [{ state: 'frozen', ySplit: 5 }];
    if (q.terms) { ws.addRow([]); ws.addRow(['Terms & conditions']).font = { bold: true }; q.terms.split('\n').forEach((t) => ws.addRow([t])); }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ───────── reads ─────────

  /** GST by rate for a saved quotation, from its own lines and the rules it was saved with. */
  private storedGstBreakdown(q: { items: { quantity: unknown; unitPrice: unknown; discountPercent: unknown; discountAmount: unknown; gstPercent: unknown }[]; discountPercent: unknown; discountAmount: unknown; roundGrandTotal: boolean; rules: unknown }) {
    const text = (v: unknown) => (v === null || v === undefined ? undefined : String(v));
    return calculateQuotation({
      lines: q.items.map((i) => ({ quantity: String(i.quantity), unitPrice: String(i.unitPrice), discountPercent: text(i.discountPercent), discountAmount: text(i.discountAmount), gstPercent: String(i.gstPercent) })),
      discountPercent: text(q.discountPercent), discountAmount: text(q.discountAmount), roundGrandTotal: q.roundGrandTotal,
    }, q.rules as Partial<CalcRules>).gstBreakdown.map((b) => ({ percent: b.percent.toString(), taxable: b.taxable.toString(), gst: b.gst.toString() }));
  }

  async get(id: string) {
    await this.expireOverdue();
    const q = await this.prisma.quotation.findFirst({
      where: { id, deletedAt: null },
      include: { items: { orderBy: { sortOrder: 'asc' }, include: { costing: { select: { costingNumber: true, version: true, status: true, deletedAt: true } } } }, preparedBy: { select: { id: true, name: true } } },
    });
    if (!q) throw new NotFoundException('Quotation not found');
    const open = ['DRAFT', 'PENDING', 'SENT', 'APPROVED'].includes(q.status);
    const imgs = await this.images.mainImages('costing', q.items.map((i) => i.costingId).filter((x): x is string => !!x));
    const items = q.items.map(({ costing, ...i }) => {
      const reason = !costing || i.source === 'MANUAL' ? null : costing.deletedAt ? 'Costing deleted' : costing.status !== 'APPROVED' ? 'Costing is no longer approved' : costing.version !== i.costingVersion ? 'Costing changed since quoting' : null;
      return { ...i, costingNumber: costing?.costingNumber ?? null, stale: open && reason !== null, staleReason: open ? reason : null, image: i.costingId ? (imgs.get(i.costingId) ?? null) : null };
    });
    const reviewFlags = await this.prisma.reviewFlag.findMany({ where: { quotationId: id, resolvedAt: null }, orderBy: { createdAt: 'desc' }, select: { id: true, reason: true, createdAt: true } });
    const { items: _i, ...head } = q;
    const days = Math.max(1, Math.round((q.validUntil.getTime() - q.quotationDate.getTime()) / 86_400_000));
    return {
      ...head, items, reviewFlags, needsReview: items.some((i) => i.stale) || (open && reviewFlags.length > 0),
      // anything past draft is shown as saved; building this needs the lines, so a draft (always previewed live) skips it
      gstBreakdown: q.status === 'DRAFT' ? [] : this.storedGstBreakdown(q),
      payload: {
        customerId: q.customerId ?? '', customerName: q.customerName, customerMobile: q.customerMobile ?? '', customerEmail: q.customerEmail ?? '', customerAddress: q.customerAddress ?? '',
        customerGstin: q.customerGstin ?? '', customerState: q.customerState ?? '', quotationDate: isoDay(q.quotationDate), validityDays: days, subject: q.subject ?? '', terms: q.terms ?? '', notes: q.notes ?? '',
        discountPercent: s(q.discountPercent) ?? '', discountAmount: s(q.discountAmount) ?? '', roundGrandTotal: q.roundGrandTotal,
        items: items.map((i) => ({
          source: i.source, costingId: i.costingId ?? '', priceListItemId: i.priceListItemId ?? '', profitPercent: s(i.profitPercent) ?? '', productName: i.productName, productCode: i.productCode ?? '',
          description: i.description ?? '', quantity: s(i.quantity)!, unitId: i.unitId ?? '', unitLabel: i.unitLabel ?? '', unitPrice: i.source === 'MANUAL' ? s(i.unitPrice)! : '',
          discountPercent: s(i.discountPercent) ?? '', discountAmount: s(i.discountAmount) ?? '', gstPercent: s(i.gstPercent)!,
        })),
      },
    };
  }

  async list(q: Record<string, string | undefined>) {
    await this.expireOverdue();
    const where: Prisma.QuotationWhereInput = { deletedAt: null };
    if (q.status) where.status = q.status as never;
    if (q.customerId) where.customerId = q.customerId;
    if (q.search) where.OR = ['number', 'customerName', 'subject'].map((f) => ({ [f]: { contains: q.search, mode: 'insensitive' } }));
    if (q.from || q.to) where.quotationDate = { ...(q.from ? { gte: new Date(`${q.from}T00:00:00.000Z`) } : {}), ...(q.to ? { lte: new Date(`${q.to}T00:00:00.000Z`) } : {}) };
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 25));
    const [rows, total] = await Promise.all([
      this.prisma.quotation.findMany({
        where, orderBy: [{ quotationDate: 'desc' }, { createdAt: 'desc' }], skip: (page - 1) * pageSize, take: pageSize,
        select: { id: true, number: true, quotationDate: true, validUntil: true, status: true, customerName: true, subject: true, grandTotal: true, preparedBy: { select: { name: true } }, _count: { select: { items: true } } },
      }),
      this.prisma.quotation.count({ where }),
    ]);
    const reviewFromFlags = new Set<string>();
    const linked = rows.length
      ? await this.prisma.quotationItem.findMany({ where: { quotationId: { in: rows.map((r) => r.id) }, source: { not: 'MANUAL' } }, select: { quotationId: true, costingVersion: true, costing: { select: { version: true, status: true, deletedAt: true } } } })
      : [];
    const flagged = rows.length ? await this.prisma.reviewFlag.findMany({ where: { quotationId: { in: rows.map((r) => r.id) }, resolvedAt: null }, select: { quotationId: true } }) : [];
    for (const f of flagged) if (f.quotationId) reviewFromFlags.add(f.quotationId);
    const review = new Set(linked.filter((l) => !l.costing || l.costing.deletedAt || l.costing.status !== 'APPROVED' || l.costing.version !== l.costingVersion).map((l) => l.quotationId));
    return {
      items: rows.map(({ _count, ...r }) => ({ ...r, itemCount: _count.items, needsReview: (review.has(r.id) || reviewFromFlags.has(r.id)) && ['DRAFT', 'PENDING', 'SENT', 'APPROVED'].includes(r.status) })),
      total, page, pageSize,
    };
  }

  private async mustFind(id: string) {
    const q = await this.prisma.quotation.findFirst({ where: { id, deletedAt: null } });
    if (!q) throw new NotFoundException('Quotation not found');
    return q;
  }
}
