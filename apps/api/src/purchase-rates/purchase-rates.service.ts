import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { computeRateStats, conversionsWithRules, convertQuantity, d, IncompatibleUnitsError, selectCurrentRate } from '@costing/costing-engine';
import { activeConversionRules } from '../common/conversion-rules';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { parseOrThrow } from '../masters/master.service';
import { manualRateSchema, purchaseRateSchema } from '@costing/validators';
import type { AuthUser } from '../common/decorators';
import { RateImpactService } from './rate-impact.service';
import { ChangeBus } from '../recalc/change-bus';

type Tx = Prisma.TransactionClient;
export type RateSource = 'PURCHASE' | 'PURCHASE_DELETED' | 'MANUAL' | 'IMPORT';

export interface EntryInput {
  itemId: string; supplierId?: string; unitId: string; quantity?: string; rate: string;
  purchaseDate: string; referenceNo?: string; notes?: string;
}

export interface NormalisedRow {
  itemId: string; supplierId: string | null; unitId: string; rate: string; quantity: string;
  baseRate: string; baseQuantity: string; purchaseDate: Date; referenceNo: string | null; notes: string | null;
}
const asDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

@Injectable()
export class PurchaseRatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly impact: RateImpactService,
    @Optional() private readonly bus?: ChangeBus,
  ) {}

  /** Normalise an entry to the item's base unit; throws 400 for incompatible units. */
  async normalise(db: Tx | PrismaService, input: EntryInput) {
    const item = await db.item.findFirst({
      where: { id: input.itemId, deletedAt: null },
      include: { unit: true, unitConversions: { include: { unit: true } } },
    });
    if (!item) throw new BadRequestException('itemId: Item not found');
    const unit = input.unitId === item.unitId ? item.unit : await db.unit.findFirst({ where: { id: input.unitId, deletedAt: null } });
    if (!unit) throw new BadRequestException('unitId: Unit not found');
    if (input.supplierId && !(await db.supplier.findFirst({ where: { id: input.supplierId, deletedAt: null } }))) {
      throw new BadRequestException('supplierId: Supplier not found');
    }
    let factor;
    try {
      const ref = (u: typeof unit) => ({ id: u.id, unitType: u.unitType, baseFactor: u.baseFactor?.toString() ?? null });
      factor = convertQuantity(1, ref(unit), ref(item.unit), {
        baseUnitId: item.unitId,
        conversions: conversionsWithRules({ id: item.id, baseUnitId: item.unitId, conversions: item.unitConversions.map((c) => ({ unitId: c.unitId, conversionValue: c.conversionValue.toString() })) }, await activeConversionRules(db)),
      });
    } catch (e) {
      if (e instanceof IncompatibleUnitsError) {
        throw new BadRequestException(`unitId: ${unit.symbol} cannot be converted to the item's base unit ${item.unit.symbol}. Add a unit conversion on the item first.`);
      }
      throw e;
    }
    const quantity = d(input.quantity ?? '1');
    return {
      item,
      row: {
        itemId: input.itemId, supplierId: input.supplierId ?? null, unitId: input.unitId,
        rate: input.rate, quantity: quantity.toString(),
        baseRate: d(input.rate).div(factor).toDecimalPlaces(6).toString(),
        baseQuantity: quantity.times(factor).toDecimalPlaces(6).toString(),
        purchaseDate: asDate(input.purchaseDate), referenceNo: input.referenceNo ?? null, notes: input.notes ?? null,
      },
    };
  }

  /**
   * Recompute an item's min/max/average and current rate from its live purchase entries.
   * Writes a history row whenever the current rate actually moves.
   */
  async recalcItem(tx: Tx, itemId: string, source: RateSource, actorId: string | null, reason?: string) {
    const item = await tx.item.findUniqueOrThrow({ where: { id: itemId } });
    const entries = await tx.purchaseRate.findMany({
      where: { itemId, deletedAt: null }, orderBy: [{ purchaseDate: 'asc' }, { createdAt: 'asc' }],
      select: { baseRate: true, baseQuantity: true, purchaseDate: true },
    });
    const stats = computeRateStats(entries.map((e) => ({ baseRate: e.baseRate.toString(), baseQuantity: e.baseQuantity.toString(), date: e.purchaseDate })));
    // Items that are not Min/Max/Avg capable always use the plain latest purchase rate.
    const method = item.hasRateRange ? item.rateMethod : 'LAST_PURCHASE';
    const next = entries.length || method === 'MANUAL' ? selectCurrentRate(method, stats) : await this.rateBeforePurchases(tx, itemId);

    const data: Prisma.ItemUpdateInput = {};
    if (item.hasRateRange) {
      data.minRate = stats.min?.toString() ?? null;
      data.maxRate = stats.max?.toString() ?? null;
      data.avgRate = (item.rateMethod === 'SIMPLE_AVERAGE' ? stats.simpleAverage : stats.weightedAverage)?.toString() ?? null;
    }
    const sameVal = (x: { toString(): string } | null | undefined, y: string | null | undefined) => (x == null || y == null ? x == null && y == null : d(x.toString()).equals(d(y)));
    const rangeChanged = item.hasRateRange && (!sameVal(item.minRate, data.minRate as string | null) || !sameVal(item.maxRate, data.maxRate as string | null) || !sameVal(item.avgRate, data.avgRate as string | null));
    const old = d(item.defaultPurchaseRate.toString());
    const moved = next !== null && !next.equals(old);
    if (moved) data.defaultPurchaseRate = next!.toString();
    if (Object.keys(data).length) await tx.item.update({ where: { id: itemId }, data });

    if (moved) {
      const impact = await this.impact.measure(itemId);
      await tx.purchaseRateHistory.create({
        data: {
          itemId, oldRate: old.toString(), newRate: next!.toString(), source, reason: reason ?? null, changedBy: actorId,
          minRate: item.hasRateRange ? (stats.min?.toString() ?? null) : null,
          maxRate: item.hasRateRange ? (stats.max?.toString() ?? null) : null,
          avgRate: item.hasRateRange ? ((data.avgRate as string | null) ?? null) : null,
          impact: impact as unknown as Prisma.InputJsonValue,
        },
      });
    }
    return { moved, rangeChanged, oldRate: old.toString(), newRate: (moved ? next! : old).toString(), stats };
  }

  /**
   * With every purchase gone, the rate goes back to what it was before purchases started moving it. A rate someone set by hand
   * after those purchases is a deliberate decision, so it stays.
   */
  private async rateBeforePurchases(tx: Tx, itemId: string) {
    const changes = await tx.purchaseRateHistory.findMany({ where: { itemId }, orderBy: { changedAt: 'desc' }, select: { oldRate: true, source: true } });
    if (changes[0]?.source === 'MANUAL') return null;
    const sinceManual = changes.findIndex((c) => c.source === 'MANUAL');
    const earliest = sinceManual === -1 ? changes[changes.length - 1] : changes[sinceManual - 1];
    return earliest ? d(earliest.oldRate.toString()) : null;
  }

  /** Supplier-wise rate = that supplier's most recent purchase (per base unit). */
  private async syncSupplierRate(tx: Tx, itemId: string, supplierId: string): Promise<boolean> {
    const latest = await tx.purchaseRate.findFirst({
      where: { itemId, supplierId, deletedAt: null }, orderBy: [{ purchaseDate: 'desc' }, { createdAt: 'desc' }],
    });
    if (!latest) return false;
    const current = await tx.itemSupplier.findUnique({ where: { itemId_supplierId: { itemId, supplierId } } });
    const changed = !current || !d(current.rate.toString()).equals(d(latest.baseRate.toString()));
    await tx.itemSupplier.upsert({
      where: { itemId_supplierId: { itemId, supplierId } },
      update: { rate: latest.baseRate.toString() },
      create: { itemId, supplierId, rate: latest.baseRate.toString() },
    });
    return changed;
  }

  /** Insert many entries and recalc each touched item once. Used by single create and by Excel import. */
  async insertEntries(tx: Tx, rows: NormalisedRow[], actorId: string, source: RateSource) {
    for (const r of rows) await tx.purchaseRate.create({ data: { ...r, createdBy: actorId } });
    const pairs = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!pairs.has(r.itemId)) pairs.set(r.itemId, new Set());
      if (r.supplierId) pairs.get(r.itemId)!.add(r.supplierId);
    }
    const changes = [];
    for (const [itemId, suppliers] of pairs) {
      let supplierChanged = false;
      for (const s of suppliers) supplierChanged = (await this.syncSupplierRate(tx, itemId, s)) || supplierChanged;
      changes.push({ itemId, supplierChanged, ...(await this.recalcItem(tx, itemId, source, actorId)) });
    }
    return changes;
  }

  async create(actor: AuthUser, body: unknown) {
    const input = parseOrThrow(purchaseRateSchema, body) as EntryInput;
    const { row, item } = await this.normalise(this.prisma, input);
    const { id, change, supplierChanged } = await this.prisma.$transaction(async (tx) => {
      const created = await tx.purchaseRate.create({ data: { ...row, createdBy: actor.id } });
      const supplierChanged = row.supplierId ? await this.syncSupplierRate(tx, row.itemId, row.supplierId) : false;
      return { id: created.id, supplierChanged, change: await this.recalcItem(tx, row.itemId, 'PURCHASE', actor.id) };
    });
    await this.audit.log({ userId: actor.id, action: 'create', entity: 'PurchaseRate', entityId: id, metadata: { itemId: row.itemId, rate: row.rate } });
    await this.announce({ itemId: row.itemId, itemName: item.name, supplierChanged, ...change }, actor.id);
    return { id, rateChange: { moved: change.moved, oldRate: change.oldRate, newRate: change.newRate } };
  }

  async remove(actor: AuthUser, id: string) {
    const entry = await this.prisma.purchaseRate.findFirst({ where: { id, deletedAt: null } });
    if (!entry) throw new NotFoundException('Purchase rate not found');
    const { change, supplierChanged } = await this.prisma.$transaction(async (tx) => {
      await tx.purchaseRate.update({ where: { id }, data: { deletedAt: new Date() } });
      const supplierChanged = entry.supplierId ? await this.syncSupplierRate(tx, entry.itemId, entry.supplierId) : false;
      return { supplierChanged, change: await this.recalcItem(tx, entry.itemId, 'PURCHASE_DELETED', actor.id, 'Purchase entry removed') };
    });
    await this.audit.log({ userId: actor.id, action: 'delete', entity: 'PurchaseRate', entityId: id, metadata: { itemId: entry.itemId } });
    const named = await this.prisma.item.findUnique({ where: { id: entry.itemId }, select: { name: true } });
    await this.announce({ itemId: entry.itemId, itemName: named?.name ?? '', supplierChanged, ...change }, actor.id);
    return { id, rateChange: { moved: change.moved, oldRate: change.oldRate, newRate: change.newRate } };
  }

  /** Manual override of the item's current rate. Purchases recorded later may move it again unless the method is MANUAL. */
  async setManualRate(actor: AuthUser, itemId: string, body: unknown) {
    const { newRate, reason } = parseOrThrow(manualRateSchema, body) as { newRate: string; reason: string };
    const item = await this.prisma.item.findFirst({ where: { id: itemId, deletedAt: null } });
    if (!item) throw new NotFoundException('Item not found');
    const old = d(item.defaultPurchaseRate.toString());
    if (d(newRate).equals(old)) throw new BadRequestException('newRate: The rate is unchanged');
    await this.prisma.$transaction(async (tx) => {
      const impact = await this.impact.measure(itemId);
      await tx.item.update({ where: { id: itemId }, data: { defaultPurchaseRate: newRate, updatedBy: actor.id } });
      await tx.purchaseRateHistory.create({
        data: { itemId, oldRate: old.toString(), newRate, source: 'MANUAL', reason, changedBy: actor.id, impact: impact as unknown as Prisma.InputJsonValue },
      });
    });
    await this.audit.log({ userId: actor.id, action: 'manual_rate_change', entity: 'Item', entityId: itemId, metadata: { from: old.toString(), to: newRate, reason } });
    await this.bus?.emit({ kind: 'ITEM_RATE', sourceId: itemId, sourceName: item.name, before: old.toString(), after: newRate, note: `Manual rate change: ${reason}`, actorId: actor.id });
    const auto = item.hasRateRange ? item.rateMethod !== 'MANUAL' : true;
    return {
      itemId, oldRate: old.toString(), newRate,
      warning: auto ? 'This item\'s rate follows its purchases, so the next recorded purchase may replace this manual rate. Set the item\'s rate method to Manual (with Min/Max/Average enabled) to keep it.' : undefined,
    };
  }

  async previewImpact(itemId: string, newRate?: string) {
    const item = await this.prisma.item.findFirst({ where: { id: itemId, deletedAt: null }, include: { unit: { select: { symbol: true } } } });
    if (!item) throw new NotFoundException('Item not found');
    if (newRate !== undefined && !/^\d+(\.\d+)?$/.test(newRate)) throw new BadRequestException('newRate must be a non-negative number');
    const old = d(item.defaultPurchaseRate.toString());
    const next = newRate === undefined ? old : d(newRate);
    const { affected, total } = await this.impact.measure(itemId);
    return {
      itemId, itemName: item.name, unit: item.unit.symbol, oldRate: old.toString(), newRate: next.toString(),
      changePercent: old.isZero() ? null : next.minus(old).div(old).times(100).toDecimalPlaces(2).toString(),
      affected, totalAffected: total,
      message: `Changing ${item.name} rate from ${old.toString()} to ${next.toString()} will affect ${total} live record(s).`,
    };
  }

  /** Tell the recalculation workflow that an item's rate, min/max/average or a supplier's rate changed (after commit). */
  async announce(c: { itemId: string; itemName: string; moved: boolean; rangeChanged: boolean; supplierChanged: boolean; oldRate: string; newRate: string }, actorId: string | null) {
    if (!this.bus || !(c.moved || c.rangeChanged || c.supplierChanged)) return;
    await this.bus.emit({
      kind: 'ITEM_RATE', sourceId: c.itemId, sourceName: c.itemName, before: c.moved ? c.oldRate : null, after: c.moved ? c.newRate : null, actorId,
      note: c.moved ? 'Purchase rate changed' : c.rangeChanged ? 'Min / max / average rate changed' : 'Supplier rate changed',
    });
  }

  async announceMany(changes: { itemId: string; moved: boolean; rangeChanged: boolean; supplierChanged: boolean; oldRate: string; newRate: string }[], actorId: string | null) {
    const hit = changes.filter((c) => c.moved || c.rangeChanged || c.supplierChanged);
    if (!hit.length || !this.bus) return;
    const names = new Map((await this.prisma.item.findMany({ where: { id: { in: hit.map((c) => c.itemId) } }, select: { id: true, name: true } })).map((i) => [i.id, i.name]));
    for (const c of hit) await this.announce({ ...c, itemName: names.get(c.itemId) ?? '' }, actorId);
  }

  // ───────── reads ─────────

  async listEntries(q: Record<string, string | undefined>) {
    const where: Prisma.PurchaseRateWhereInput = { deletedAt: null };
    if (q.itemId) where.itemId = q.itemId;
    if (q.supplierId) where.supplierId = q.supplierId;
    if (q.from || q.to) where.purchaseDate = { ...(q.from ? { gte: asDate(q.from) } : {}), ...(q.to ? { lte: asDate(q.to) } : {}) };
    if (q.search) where.OR = [
      { item: { name: { contains: q.search, mode: 'insensitive' } } }, { item: { code: { contains: q.search, mode: 'insensitive' } } },
      { referenceNo: { contains: q.search, mode: 'insensitive' } },
    ];
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 25));
    const dir = q.sortDir === 'asc' ? 'asc' : 'desc';
    const sortBy = ['purchaseDate', 'rate', 'createdAt'].includes(q.sortBy ?? '') ? q.sortBy! : 'purchaseDate';
    const [items, total] = await Promise.all([
      this.prisma.purchaseRate.findMany({
        where, orderBy: [{ [sortBy]: dir }, { createdAt: 'desc' }], skip: (page - 1) * pageSize, take: pageSize,
        include: { item: { select: { id: true, name: true, code: true, unit: { select: { symbol: true } } } }, supplier: { select: { id: true, name: true } }, unit: { select: { id: true, symbol: true } } },
      }),
      this.prisma.purchaseRate.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async summary(q: Record<string, string | undefined>) {
    const where: Prisma.ItemWhereInput = { deletedAt: null };
    if (q.search) where.OR = [{ name: { contains: q.search, mode: 'insensitive' } }, { code: { contains: q.search, mode: 'insensitive' } }];
    for (const f of ['typeId', 'groupId', 'categoryId'] as const) if (q[f]) where[f] = q[f];
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 25));
    const [items, total] = await Promise.all([
      this.prisma.item.findMany({
        where, orderBy: { name: 'asc' }, skip: (page - 1) * pageSize, take: pageSize,
        select: {
          id: true, name: true, code: true, defaultPurchaseRate: true, hasRateRange: true, minRate: true, maxRate: true, avgRate: true, rateMethod: true,
          unit: { select: { symbol: true } }, defaultSupplier: { select: { name: true } },
          _count: { select: { purchaseRates: { where: { deletedAt: null } } } },
        },
      }),
      this.prisma.item.count({ where }),
    ]);
    return { items: items.map(({ _count, ...i }) => ({ ...i, purchaseCount: _count.purchaseRates })), total, page, pageSize };
  }

  async history(q: Record<string, string | undefined>) {
    const where: Prisma.PurchaseRateHistoryWhereInput = {};
    if (q.itemId) where.itemId = q.itemId;
    if (q.source) where.source = q.source as never;
    if (q.from || q.to) where.changedAt = { ...(q.from ? { gte: asDate(q.from) } : {}), ...(q.to ? { lte: new Date(`${q.to}T23:59:59.999Z`) } : {}) };
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 25));
    const [rows, total] = await Promise.all([
      this.prisma.purchaseRateHistory.findMany({
        where, orderBy: { changedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
        include: { item: { select: { id: true, name: true, code: true, unit: { select: { symbol: true } } } } },
      }),
      this.prisma.purchaseRateHistory.count({ where }),
    ]);
    const userIds = [...new Set(rows.map((r) => r.changedBy).filter((x): x is string => !!x))];
    const users = userIds.length ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
    const names = new Map(users.map((u) => [u.id, u.name]));
    return { items: rows.map((r) => ({ ...r, changedByName: r.changedBy ? (names.get(r.changedBy) ?? null) : null })), total, page, pageSize };
  }

  /** Per-supplier view for one item: current rate, min/max, last purchase date. */
  async supplierRates(itemId: string) {
    const [links, grouped] = await Promise.all([
      this.prisma.itemSupplier.findMany({ where: { itemId }, include: { supplier: { select: { id: true, name: true, code: true } } } }),
      this.prisma.purchaseRate.groupBy({
        by: ['supplierId'], where: { itemId, deletedAt: null, supplierId: { not: null } },
        _min: { baseRate: true }, _max: { baseRate: true }, _avg: { baseRate: true }, _count: { _all: true },
      }),
    ]);
    const stats = new Map(grouped.map((g) => [g.supplierId, g]));
    return links.map((l) => {
      const g = stats.get(l.supplierId);
      return {
        supplier: l.supplier, currentRate: l.rate, isDefault: l.isDefault,
        minRate: g?._min?.baseRate ?? null, maxRate: g?._max?.baseRate ?? null, avgRate: g?._avg?.baseRate ?? null, purchaseCount: g?._count?._all ?? 0,
      };
    });
  }

  /** Units an item can be bought in: its base unit plus every converted unit. */
  async itemUnits(itemId?: string) {
    if (!itemId) return { items: [] };
    const item = await this.prisma.item.findFirst({
      where: { id: itemId, deletedAt: null }, include: { unit: true, unitConversions: { include: { unit: true } } },
    });
    if (!item) return { items: [] };
    const usable = conversionsWithRules({ id: item.id, baseUnitId: item.unitId, conversions: [] }, await activeConversionRules(this.prisma)).map((c) => c.unitId);
    const fromRules = usable.length ? await this.prisma.unit.findMany({ where: { id: { in: usable }, deletedAt: null } }) : [];
    const units = new Map([item.unit, ...item.unitConversions.map((c) => c.unit), ...fromRules].map((u) => [u.id, u]));
    return { items: [...units.values()].map((u) => ({ id: u.id, name: u.name, symbol: u.symbol })) };
  }
}
