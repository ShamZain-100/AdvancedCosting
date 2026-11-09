import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { d } from '@costing/costing-engine';
import { dismissRecalcSchema as dismissSchema, recalcPolicySchema as policySchema } from '@costing/validators';
import { RateImpactService } from '../purchase-rates/rate-impact.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CostingsService } from '../costings/costings.service';
import { CostingSettingsService } from '../costings/costing-settings.service';
import { parseOrThrow } from '../masters/master.service';
import type { AuthUser } from '../common/decorators';
import { ChangeBus, MasterChange } from './change-bus';

export const AUTO_APPLY_LIMIT = 200;
export const PREVIEW_LIMIT = 500;
const LIVE_STATUSES = ['DRAFT', 'REJECTED', 'PENDING_APPROVAL'] as const;
const OPEN_QUOTATION = ['DRAFT', 'PENDING', 'SENT', 'APPROVED'] as const;
const OPEN_PRICE_LIST = ['DRAFT', 'ACTIVE'] as const;


export type Policy = { mode: 'AUTO' | 'CONFIRM' | 'MANUAL'; flagThresholdPercent: number };

/** Background actor for automatic recalculations: no permissions, so it can never introduce custom rates. */
const systemActor = (id: string | null | undefined): AuthUser => ({ id: id ?? 'system', email: '', name: 'System', isSuperAdmin: false, sessionId: 'system', permissions: new Set<string>() });

const describe = (c: MasterChange) =>
  c.kind === 'ITEM_RATE' && c.before != null && c.after != null ? `${c.sourceName}: rate ${c.before} → ${c.after}`
    : c.kind === 'LABOUR_RATE' && c.before != null && c.after != null ? `${c.sourceName}: labour rate ${c.before} → ${c.after}`
      : c.kind === 'EXPENSE_DEFAULT' && c.before != null && c.after != null ? `${c.sourceName}: default ${c.before} → ${c.after}`
        : c.kind === 'ITEM_GST' && c.before != null && c.after != null ? `${c.sourceName}: GST ${c.before}% → ${c.after}%`
          : `${c.sourceName}: ${c.note ?? c.kind.toLowerCase().replace('_', ' ') + ' changed'}`;

function changePercent(c: MasterChange): number | null {
  if (c.before == null || c.after == null || c.kind === 'ITEM_GST') return null;
  const b = d(c.before);
  return b.isZero() ? null : Number(d(c.after).minus(b).div(b).times(100).toDecimalPlaces(2).toString());
}

/**
 * Live recalculation workflow. A change to something costings are calculated from (item rate, labour rate, expense
 * default, item GST / units, calculation rules) creates a batch of the LIVE costings it affects; depending on the policy
 * the batch is applied at once or waits for an admin to preview the before / after figures and confirm.
 * Approved (snapshot) costings are never part of a batch; quotations and price lists built on them get a review flag.
 */
@Injectable()
export class RecalcService implements OnModuleInit {
  private readonly logger = new Logger(RecalcService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly bus: ChangeBus,
    private readonly costings: CostingsService,
    private readonly settings: CostingSettingsService,
    private readonly impact: RateImpactService,
  ) {}

  onModuleInit() { this.bus.subscribe((c) => this.onChange(c)); }

  // ───────── policy ─────────

  async getPolicy(): Promise<Policy> {
    const row = await this.prisma.costingSettings.findUnique({ where: { id: 1 }, select: { recalcMode: true, flagThresholdPercent: true } });
    return { mode: (row?.recalcMode as Policy['mode']) ?? 'CONFIRM', flagThresholdPercent: Number(row?.flagThresholdPercent?.toString() ?? 0) };
  }

  async setPolicy(actor: AuthUser, body: unknown): Promise<Policy> {
    const p = parseOrThrow(policySchema, body) as Policy;
    const rules = await this.settings.getRules();
    await this.prisma.costingSettings.upsert({
      where: { id: 1 }, update: { recalcMode: p.mode, flagThresholdPercent: p.flagThresholdPercent, updatedBy: actor.id },
      create: { id: 1, rules: rules as unknown as Prisma.InputJsonValue, recalcMode: p.mode, flagThresholdPercent: p.flagThresholdPercent, updatedBy: actor.id },
    });
    await this.audit.log({ userId: actor.id, action: 'update', entity: 'RecalculationPolicy', entityId: '1', metadata: { ...p } });
    return p;
  }

  // ───────── reacting to a change ─────────

  private usageWhere(c: MasterChange): Prisma.CostingWhereInput | null {
    switch (c.kind) {
      case 'ITEM_RATE': case 'ITEM_GST': case 'ITEM_UNITS':
        return { groups: { some: { categories: { some: { materials: { some: { itemId: c.sourceId! } } } } } } };
      case 'LABOUR_RATE': return { groups: { some: { labour: { some: { labourId: c.sourceId!, customRate: false } } } } };
      case 'EXPENSE_DEFAULT': return { expenses: { some: { expenseId: c.sourceId! } } };
      // company expenses are added to every costing, so every live costing follows a change to them
      case 'RULES': case 'COMPANY_EXPENSE': return {};
      case 'DEALER': return null; // no costing is calculated from a dealer
    }
  }

  /** Live costings (not approved) that follow the changed input. */
  async affectedCostings(c: MasterChange | { kind: MasterChange['kind']; sourceId: string | null }): Promise<string[]> {
    const where = this.usageWhere(c as MasterChange);
    if (!where) return [];
    const rows = await this.prisma.costing.findMany({ where: { deletedAt: null, pricingMode: 'LIVE', status: { in: [...LIVE_STATUSES] }, ...where }, select: { id: true }, orderBy: { costingDate: 'desc' } });
    return rows.map((r) => r.id);
  }

  async onChange(c: MasterChange) {
    if (c.kind === 'DEALER') return; // dealer prices are worked out from approved figures; no costing follows a dealer
    if (c.logHistory && c.kind === 'ITEM_RATE' && c.sourceId && c.before != null && c.after != null) {
      const impact = await this.impact.measure(c.sourceId).catch(() => ({ affected: [], total: 0 }));
      await this.prisma.purchaseRateHistory.create({
        data: { itemId: c.sourceId, oldRate: c.before, newRate: c.after, source: 'MANUAL', reason: c.note ?? 'Edited in the item master', changedBy: c.actorId ?? null, impact: impact as unknown as Prisma.InputJsonValue },
      });
    }
    const policy = await this.getPolicy();
    const pct = changePercent(c);
    const flagged = await this.flagFrozenDocuments(c, pct, policy);
    if (policy.mode === 'MANUAL') return;
    const affected = await this.affectedCostings(c);
    if (!affected.length) return;

    const summary = describe(c);
    const existing = await this.prisma.recalculationBatch.findFirst({ where: { kind: c.kind, sourceId: c.sourceId, status: { in: ['PENDING', 'PARTIAL'] } } });
    const data = { summary, changePercent: pct, costingCount: affected.length, flaggedCount: flagged };
    const batch = existing
      ? await this.prisma.recalculationBatch.update({ where: { id: existing.id }, data })
      : await this.prisma.recalculationBatch.create({ data: { kind: c.kind, sourceId: c.sourceId, sourceName: c.sourceName, createdBy: c.actorId ?? null, ...data } });
    // flags raised before the batch existed should point at it
    await this.prisma.reviewFlag.updateMany({ where: { sourceKey: this.sourceKey(c), resolvedAt: null, batchId: null }, data: { batchId: batch.id } });

    if (policy.mode === 'AUTO' && affected.length <= AUTO_APPLY_LIMIT) {
      await this.apply(systemActor(c.actorId), batch.id, { system: true });
    } else if (policy.mode === 'AUTO') {
      this.logger.warn(`${summary}: ${affected.length} costings is more than the automatic limit (${AUTO_APPLY_LIMIT}); waiting for confirmation`);
    }
  }

  // ───────── frozen documents: flag, never change ─────────

  private sourceKey(c: MasterChange) { return `${c.kind}:${c.sourceId ?? 'all'}`; }

  private async flagFrozenDocuments(c: MasterChange, pct: number | null, policy: Policy): Promise<number> {
    const where = this.usageWhere(c);
    if (!where || c.kind === 'RULES' || c.kind === 'COMPANY_EXPENSE') return 0;
    if (pct !== null && Math.abs(pct) < policy.flagThresholdPercent) return 0;
    const used = await this.prisma.costing.findMany({ where: { deletedAt: null, ...where }, select: { id: true }, take: 5000 });
    if (!used.length) return 0;
    const ids = used.map((u) => u.id);
    const reason = `${describe(c)} (frozen prices on this document were not changed)`;
    const key = this.sourceKey(c);
    const [quotations, lists] = await Promise.all([
      this.prisma.quotation.findMany({ where: { deletedAt: null, status: { in: [...OPEN_QUOTATION] }, items: { some: { costingId: { in: ids } } } }, select: { id: true } }),
      this.prisma.priceList.findMany({ where: { deletedAt: null, status: { in: [...OPEN_PRICE_LIST] }, items: { some: { costingId: { in: ids } } } }, select: { id: true } }),
    ]);
    const qIds = quotations.map((q) => q.id), pIds = lists.map((l) => l.id);
    if (qIds.length) {
      await this.prisma.reviewFlag.updateMany({ where: { quotationId: { in: qIds }, sourceKey: key, resolvedAt: null }, data: { reason } });
      await this.prisma.reviewFlag.createMany({ data: qIds.map((quotationId) => ({ quotationId, sourceKey: key, reason })), skipDuplicates: true });
    }
    if (pIds.length) {
      await this.prisma.reviewFlag.updateMany({ where: { priceListId: { in: pIds }, sourceKey: key, resolvedAt: null }, data: { reason } });
      await this.prisma.reviewFlag.createMany({ data: pIds.map((priceListId) => ({ priceListId, sourceKey: key, reason })), skipDuplicates: true });
    }
    return qIds.length + pIds.length;
  }

  async openFlags(actor: AuthUser) {
    const canQ = actor.permissions.has('quotations:view'), canP = actor.permissions.has('price_lists:view');
    const rows = await this.prisma.reviewFlag.findMany({
      where: { resolvedAt: null, OR: [...(canQ ? [{ quotationId: { not: null } }] : []), ...(canP ? [{ priceListId: { not: null } }] : [])] },
      orderBy: { createdAt: 'desc' }, take: 500,
      select: { id: true, reason: true, createdAt: true, batchId: true, quotation: { select: { id: true, number: true, customerName: true, status: true } }, priceList: { select: { id: true, number: true, name: true, status: true } } },
    });
    return rows.map((r) => ({ id: r.id, reason: r.reason, createdAt: r.createdAt, batchId: r.batchId, document: r.quotation ? { type: 'QUOTATION', ...r.quotation, title: r.quotation.customerName } : { type: 'PRICE_LIST', ...r.priceList!, title: r.priceList!.name } }));
  }

  async resolveFlag(actor: AuthUser, id: string) {
    const f = await this.prisma.reviewFlag.findUnique({ where: { id } });
    if (!f || f.resolvedAt) throw new NotFoundException('Flag not found');
    const need = f.quotationId ? 'quotations:edit' : 'price_lists:edit';
    if (!actor.permissions.has(need)) throw new ForbiddenException(`You need the ${need} permission`);
    await this.prisma.reviewFlag.update({ where: { id }, data: { resolvedAt: new Date(), resolvedBy: actor.id } });
    await this.audit.log({ userId: actor.id, action: 'resolve_review_flag', entity: f.quotationId ? 'Quotation' : 'PriceList', entityId: f.quotationId ?? f.priceListId!, metadata: { flagId: id } });
    return { id };
  }

  // ───────── batches ─────────

  async list(q: Record<string, string | undefined>) {
    const where: Prisma.RecalculationBatchWhereInput = q.status ? { status: q.status as never } : {};
    const page = Math.max(1, Number(q.page) || 1), pageSize = Math.min(100, Math.max(1, Number(q.pageSize) || 25));
    const [items, total] = await Promise.all([
      this.prisma.recalculationBatch.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.recalculationBatch.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async get(id: string) {
    const batch = await this.prisma.recalculationBatch.findUnique({
      where: { id }, include: { items: { orderBy: { processedAt: 'desc' }, take: 500, include: { costing: { select: { costingNumber: true, productName: true } } } } },
    });
    if (!batch) throw new NotFoundException('Recalculation not found');
    return batch;
  }

  /** What applying would do, per costing, without writing anything. */
  async preview(actor: AuthUser, id: string) {
    const batch = await this.prisma.recalculationBatch.findUnique({ where: { id } });
    if (!batch) throw new NotFoundException('Recalculation not found');
    const ids = await this.affectedCostings({ kind: batch.kind, sourceId: batch.sourceId });
    const shown = ids.slice(0, PREVIEW_LIMIT);
    const rows = [];
    for (const cid of shown) {
      try { rows.push(await this.costings.recalculate(systemActor(actor.id), cid, { dryRun: true })); }
      catch (e) { rows.push({ id: cid, number: '', product: '', status: '', outcome: 'FAILED' as const, reason: (e as Error).message, before: null, after: null, warnings: [] as string[] }); }
    }
    const changed = rows.filter((r) => r.outcome === 'CHANGED');
    const delta = changed.reduce((s, r) => s.plus(d(r.after!.selling).minus(d(r.before!.selling))), d(0));
    return {
      batch, rows, truncated: ids.length > shown.length, totalAffected: ids.length,
      totals: {
        changed: changed.length, unchanged: rows.filter((r) => r.outcome === 'UNCHANGED').length, skipped: rows.filter((r) => r.outcome === 'SKIPPED').length, failed: rows.filter((r) => r.outcome === 'FAILED').length,
        sellingPriceChange: delta.toFixed(2),
      },
    };
  }

  /**
   * Recalculate every costing the batch still affects. Each costing is its own transaction, so one failure never blocks
   * the others; costings waiting for approval are skipped and stay in the batch (status PARTIAL) for a later run.
   */
  async apply(actor: AuthUser, id: string, opts: { system?: boolean } = {}) {
    if (!opts.system && !(actor.permissions.has('purchase_rates:manage_rates') && actor.permissions.has('costing:edit'))) {
      throw new ForbiddenException('Applying a recalculation needs the purchase_rates:manage_rates and costing:edit permissions');
    }
    const batch = await this.prisma.recalculationBatch.findUnique({ where: { id } });
    if (!batch) throw new NotFoundException('Recalculation not found');
    // claim the batch so two admins (or a double click) cannot apply it twice
    const claimed = await this.prisma.recalculationBatch.updateMany({ where: { id, status: { in: ['PENDING', 'PARTIAL'] } }, data: { status: 'APPLYING' } });
    if (!claimed.count) throw new ConflictException(`This recalculation is already ${batch.status.toLowerCase()}`);

    const ids = await this.affectedCostings({ kind: batch.kind, sourceId: batch.sourceId });
    const counts = { applied: 0, unchanged: 0, skipped: 0, failed: 0 };
    const items: Prisma.RecalculationItemCreateManyInput[] = [];
    for (const cid of ids) {
      try {
        const r = await this.costings.recalculate(actor, cid, { note: `${batch.summary} (recalculation)` });
        const status = r.outcome === 'CHANGED' ? 'APPLIED' : r.outcome === 'UNCHANGED' ? 'UNCHANGED' : 'SKIPPED';
        counts[status === 'APPLIED' ? 'applied' : status === 'UNCHANGED' ? 'unchanged' : 'skipped']++;
        items.push({ batchId: id, costingId: cid, status, reason: r.reason, sellingBefore: r.before.selling, sellingAfter: r.after.selling, basicBefore: r.before.basic, basicAfter: r.after.basic });
      } catch (e) {
        counts.failed++;
        items.push({ batchId: id, costingId: cid, status: 'FAILED', reason: (e as Error).message.slice(0, 250) });
      }
    }
    if (items.length) await this.prisma.recalculationItem.createMany({ data: items });
    const status = counts.skipped + counts.failed > 0 ? 'PARTIAL' : 'APPLIED';
    const done = await this.prisma.recalculationBatch.update({
      where: { id },
      data: { status, appliedCount: { increment: counts.applied }, skippedCount: counts.skipped, failedCount: counts.failed, appliedBy: opts.system ? (actor.id === 'system' ? null : actor.id) : actor.id, appliedAt: new Date() },
    });
    await this.audit.log({ userId: opts.system && actor.id === 'system' ? null : actor.id, action: opts.system ? 'auto_recalculate' : 'apply_recalculation', entity: 'RecalculationBatch', entityId: id, metadata: { ...counts, summary: batch.summary } });
    return { batch: done, ...counts };
  }

  async dismiss(actor: AuthUser, id: string, body: unknown) {
    const { reason } = parseOrThrow(dismissSchema, body) as { reason: string };
    const r = await this.prisma.recalculationBatch.updateMany({ where: { id, status: { in: ['PENDING', 'PARTIAL'] } }, data: { status: 'DISMISSED', dismissedBy: actor.id, dismissedAt: new Date(), dismissReason: reason } });
    if (!r.count) {
      const b = await this.prisma.recalculationBatch.findUnique({ where: { id }, select: { status: true } });
      if (!b) throw new NotFoundException('Recalculation not found');
      throw new BadRequestException(`A ${b.status.toLowerCase()} recalculation cannot be dismissed`);
    }
    await this.audit.log({ userId: actor.id, action: 'dismiss_recalculation', entity: 'RecalculationBatch', entityId: id, metadata: { reason } });
    return { id };
  }

  /** Clears review flags when a document is repriced or revised (used by the quotation / price list services). */
  async resolveFor(target: { quotationId?: string; priceListId?: string }, actorId: string) {
    await this.prisma.reviewFlag.updateMany({ where: { ...target, resolvedAt: null }, data: { resolvedAt: new Date(), resolvedBy: actorId } });
  }
}
