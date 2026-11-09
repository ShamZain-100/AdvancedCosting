import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { calculateDealerPrice, CalcRules, d } from '@costing/costing-engine';
import { TABLE_COLUMNS, type TableName } from '@costing/config';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ImagesService } from '../images/images.service';
import { ChangeBus } from '../recalc/change-bus';
import { NotificationsService, type Message } from '../notifications/notifications.service';
import { dataWorkbook } from '../data/excel-io';
import { allowedColumns } from '../common/column-access';
import { dealerScope } from '../common/dealer-scope';
import { applyTableQuery, parseTableQuery, type TableColumn } from '../common/table-query';
import type { AuthUser } from '../common/decorators';

type Db = PrismaService | Prisma.TransactionClient;
export interface PriceChange { costingId: string; dealerId: string; before: string | null; after: string }

/** Indian-style grouping of a decimal string for messages (no floating point). */
export const money = (v: string) => {
  const [i, f = ''] = d(v).toFixed(2).split('.');
  const neg = i.startsWith('-'), n = neg ? i.slice(1) : i;
  const head = n.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ','), tail = n.slice(-3);
  return `${neg ? '-' : ''}${head ? `${head},` : ''}${tail}.${f}`;
};

const COSTING_FIELDS = {
  id: true, costingNumber: true, productName: true, productCode: true, quantity: true, unitId: true, status: true, approvedAt: true, rules: true, published: true,
  basicCost: true, totalCostInclGst: true, extraAmount: true, companyExpenseCost: true, markupAmount: true, sellingPrice: true,
} satisfies Prisma.CostingSelect;

/**
 * Dealer prices: every approved costing priced for every active price list dealer (the engine's `calculateDealerPrice`
 * on the costing's saved figures). Published costings form the price list; dealers hear about what changes for them.
 */
@Injectable()
export class DealerPricesService implements OnModuleInit {
  private readonly logger = new Logger(DealerPricesService.name);

  constructor(
    private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly images: ImagesService,
    private readonly notifications: NotificationsService, @Optional() private readonly bus?: ChangeBus,
  ) {}

  onModuleInit() {
    this.bus?.subscribe(async (c) => {
      if (c.kind !== 'DEALER' || !c.sourceId) return;
      const changes = await this.refresh({ dealerIds: [c.sourceId] });
      await this.announce(changes, 'changed');
    });
  }

  /**
   * Recomputes dealer prices from saved figures (never recalculates a costing). Rows of dealers that are switched off or
   * deleted are removed. Returns the unit prices that changed.
   */
  async refresh(opts: { costingIds?: string[]; dealerIds?: string[] }, db: Db = this.prisma): Promise<PriceChange[]> {
    const [costings, dealers] = await Promise.all([
      db.costing.findMany({ where: { deletedAt: null, status: 'APPROVED', ...(opts.costingIds ? { id: { in: opts.costingIds } } : {}) }, select: COSTING_FIELDS }),
      db.priceListDealer.findMany({ where: { ...(opts.dealerIds ? { id: { in: opts.dealerIds } } : {}) } }),
    ]);
    const active = dealers.filter((x) => x.isActive && !x.deletedAt);
    const gone = dealers.filter((x) => !x.isActive || x.deletedAt).map((x) => x.id);
    if (gone.length) await db.costingDealerPrice.deleteMany({ where: { dealerId: { in: gone } } });
    if (!costings.length || !active.length) return [];
    const existing = await db.costingDealerPrice.findMany({ where: { costingId: { in: costings.map((c) => c.id) }, dealerId: { in: active.map((x) => x.id) } } });
    const old = new Map(existing.map((e) => [`${e.costingId}|${e.dealerId}`, e]));
    const changes: PriceChange[] = [];
    for (const c of costings) {
      for (const dealer of active) {
        const r = calculateDealerPrice(
          { basicCost: c.basicCost.toString(), totalCostInclGst: c.totalCostInclGst.toString(), extraAmount: c.extraAmount.toString(), quantity: c.quantity.toString() },
          dealer.marginPercent.toString(), (c.rules ?? {}) as Partial<CalcRules>,
        );
        const data = {
          marginPercent: dealer.marginPercent.toString(), markupAmount: r.markupAmount.toString(), sellingPrice: r.sellingPrice.toString(),
          unitPrice: r.unitPrice.toString(), profitPercent: r.profitPercent.toString(),
        };
        const prev = old.get(`${c.id}|${dealer.id}`);
        const before = prev ? prev.unitPrice.toString() : null;
        if (prev && d(before!).equals(r.unitPrice) && d(prev.marginPercent.toString()).equals(dealer.marginPercent.toString())) continue;
        await db.costingDealerPrice.upsert({ where: { costingId_dealerId: { costingId: c.id, dealerId: dealer.id } }, update: data, create: { costingId: c.id, dealerId: dealer.id, ...data } });
        if (before === null || !d(before).equals(r.unitPrice)) changes.push({ costingId: c.id, dealerId: dealer.id, before, after: r.unitPrice.toString() });
      }
    }
    return changes;
  }

  /**
   * Tells each dealer's users what changed on their price list. Only published costings count. The price a dealer was
   * last told is kept, so a message can say what it was.
   */
  async announce(changes: PriceChange[], why: 'changed' | 'published'): Promise<number> {
    try {
      const costingIds = [...new Set(changes.map((c) => c.costingId))];
      if (!costingIds.length) return 0;
      const published = await this.prisma.costing.findMany({ where: { id: { in: costingIds }, published: true, deletedAt: null }, select: { id: true, productName: true } });
      const names = new Map(published.map((p) => [p.id, p.productName]));
      const rows = await this.prisma.costingDealerPrice.findMany({ where: { costingId: { in: [...names.keys()] }, dealerId: { in: [...new Set(changes.map((c) => c.dealerId))] } } });
      const byDealer = new Map<string, Message[]>();
      for (const row of rows) {
        if (!changes.some((c) => c.costingId === row.costingId && c.dealerId === row.dealerId)) continue;
        const now = row.unitPrice.toString(), was = row.announcedUnitPrice?.toString() ?? null;
        if (was !== null && d(was).equals(now)) continue;
        const product = names.get(row.costingId)!;
        const m: Message = was === null
          ? { kind: 'PRICE_NEW', title: `New on your price list: ${product}`, body: `Price ${money(now)} per unit.`, url: '/price-list' }
          : { kind: 'PRICE_CHANGED', title: `Price ${d(now).gt(was) ? 'increased' : 'reduced'}: ${product}`, body: `Was ${money(was)}, now ${money(now)} per unit.`, url: '/price-list' };
        byDealer.set(row.dealerId, [...(byDealer.get(row.dealerId) ?? []), m]);
        await this.prisma.costingDealerPrice.update({ where: { id: row.id }, data: { announcedUnitPrice: now } });
      }
      return await this.notifications.notifyDealers(byDealer);
    } catch (e) {
      // telling dealers is a side effect: it must never undo or block the change that caused it
      this.logger.error(`Could not notify dealers (${why}): ${(e as Error).message}`);
      return 0;
    }
  }

  /** A costing left the price list (unpublished or reopened): its dealers are told, and their last-told price is cleared. */
  async announceRemoved(costingId: string): Promise<void> {
    try {
      const c = await this.prisma.costing.findUnique({ where: { id: costingId }, select: { productName: true } });
      const rows = await this.prisma.costingDealerPrice.findMany({ where: { costingId, announcedUnitPrice: { not: null } } });
      if (!c || !rows.length) return;
      await this.prisma.costingDealerPrice.updateMany({ where: { costingId }, data: { announcedUnitPrice: null } });
      await this.notifications.notifyDealers(new Map(rows.map((r) => [r.dealerId, [{ kind: 'PRICE_REMOVED', title: `Removed from your price list: ${c.productName}`, body: 'This product is no longer on the price list.', url: '/price-list' }]])));
    } catch (e) {
      this.logger.error(`Could not notify dealers of a removal: ${(e as Error).message}`);
    }
  }

  /** Approved costings only. Publishing makes it appear for every dealer; unpublishing takes it off. */
  async setPublished(actor: AuthUser, id: string, body: unknown) {
    const published = (body as { published?: unknown })?.published;
    if (typeof published !== 'boolean') throw new BadRequestException('published must be true or false');
    const c = await this.prisma.costing.findFirst({ where: { id, deletedAt: null }, select: { id: true, status: true, published: true, costingNumber: true } });
    if (!c) throw new NotFoundException('Costing not found');
    if (published && c.status !== 'APPROVED') throw new BadRequestException('Only approved costings can be published to the price list');
    if (c.published === published) return { id, published };
    await this.prisma.costing.update({ where: { id }, data: { published, publishedAt: published ? new Date() : null, publishedById: published ? actor.id : null } });
    await this.audit.log({ userId: actor.id, action: published ? 'publish' : 'unpublish', entity: 'Costing', entityId: id, metadata: { number: c.costingNumber } });
    if (published) {
      await this.refresh({ costingIds: [id] });
      const rows = await this.prisma.costingDealerPrice.findMany({ where: { costingId: id }, select: { dealerId: true, unitPrice: true } });
      await this.announce(rows.map((r) => ({ costingId: id, dealerId: r.dealerId, before: null, after: r.unitPrice.toString() })), 'published');
    } else {
      await this.announceRemoved(id);
    }
    return { id, published };
  }

  // ───────── the two tables ─────────

  private columns(table: TableName, types: Record<string, TableColumn['type']>): TableColumn[] {
    return Object.entries(TABLE_COLUMNS[table].columns).map(([key, label]) => ({ key, label, type: types[key] ?? 'text' }));
  }

  /** All approved costings with their cost figures and the publish tick. */
  async costReport(user: AuthUser, q: Record<string, string | undefined>) {
    const visible = allowedColumns(user, 'cost_report');
    const columns = this.columns('cost_report', { approvedAt: 'date', quantity: 'number', basicCost: 'money', companyExpenseCost: 'money', extraAmount: 'money', markupAmount: 'money', sellingPrice: 'money', published: 'boolean' })
      .filter((c) => visible.has(c.key));
    const rows = (await this.prisma.costing.findMany({ where: { deletedAt: null, status: 'APPROVED' }, select: COSTING_FIELDS, orderBy: { approvedAt: 'desc' }, take: 20000 })).map((c) => ({
      id: c.id, costingNumber: c.costingNumber, productName: c.productName, productCode: c.productCode, approvedAt: c.approvedAt?.toISOString() ?? null,
      quantity: c.quantity.toString(), basicCost: c.basicCost.toString(), companyExpenseCost: c.companyExpenseCost.toString(), extraAmount: c.extraAmount.toString(),
      markupAmount: c.markupAmount.toString(), sellingPrice: c.sellingPrice.toString(), published: c.published,
    }));
    return this.table(columns, rows, q);
  }

  /** Published costings with one price column per dealer the user may see. */
  async priceList(user: AuthUser, q: Record<string, string | undefined>) {
    const visible = allowedColumns(user, 'price_list');
    const scope = await dealerScope(this.prisma, user);
    const dealers = scope && !scope.length ? [] : await this.prisma.priceListDealer.findMany({
      where: { deletedAt: null, isActive: true, ...(scope ? { id: { in: scope } } : {}) }, orderBy: { name: 'asc' }, select: { id: true, name: true, code: true },
    });
    const showPrices = visible.has('dealerPrices');
    const base = this.columns('price_list', { image: 'image' }).filter((c) => c.key !== 'dealerPrices' && visible.has(c.key));
    const columns: TableColumn[] = [...base, ...(showPrices ? dealers.map((x) => ({ key: `dealer_${x.id}`, label: `${x.name} price`, type: 'money' as const })) : [])];
    // a dealer login sees products only once it belongs to a dealer
    const costings = scope && !scope.length ? [] : await this.prisma.costing.findMany({
      where: { deletedAt: null, status: 'APPROVED', published: true }, orderBy: { productName: 'asc' }, take: 20000,
      select: { id: true, productName: true, productCode: true, unitId: true, dealerPrices: { where: { dealerId: { in: dealers.map((x) => x.id) } }, select: { dealerId: true, unitPrice: true } } },
    });
    const units = new Map((await this.prisma.unit.findMany({ where: { id: { in: [...new Set(costings.map((c) => c.unitId).filter((x): x is string => !!x))] } }, select: { id: true, symbol: true } })).map((u) => [u.id, u.symbol]));
    const imgs = visible.has('image') ? await this.images.mainImages('costing', costings.map((c) => c.id)) : new Map();
    const rows = costings.map((c) => ({
      id: c.id, image: imgs.get(c.id)?.thumbUrl ?? null, productName: c.productName, productCode: c.productCode, unit: c.unitId ? (units.get(c.unitId) ?? null) : null,
      ...Object.fromEntries(c.dealerPrices.map((p) => [`dealer_${p.dealerId}`, p.unitPrice.toString()])),
    }));
    return { ...this.table(columns, rows, q), dealers: showPrices ? dealers : [] };
  }

  private table(columns: TableColumn[], rows: Record<string, unknown>[], q: Record<string, string | undefined>) {
    const query = parseTableQuery(q, columns);
    const keep = new Set(['id', ...columns.map((c) => c.key)]);
    const visibleRows = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => keep.has(k))));
    const { all, items, total, page, pageSize } = applyTableQuery(visibleRows, columns, query);
    return { columns, items, total, page, pageSize, all };
  }

  async excel(user: AuthUser, which: 'cost-report' | 'price-list', q: Record<string, string | undefined>) {
    const t = which === 'cost-report' ? await this.costReport(user, q) : await this.priceList(user, q);
    const cols = t.columns.filter((c) => c.type !== 'image');
    const value = (v: unknown, type: string) => (v === null || v === undefined ? null : type === 'money' || type === 'number' ? Number(v) : type === 'boolean' ? (v ? 'Yes' : 'No') : type === 'date' ? String(v).slice(0, 10) : String(v));
    const buffer = await dataWorkbook(which === 'cost-report' ? 'Cost report' : 'Price list', cols.map((c) => c.label), t.all.map((r) => cols.map((c) => value(r[c.key], c.type))), cols.map((c) => (c.type === 'text' ? 28 : 16)));
    return { buffer, filename: `${which}-${new Date().toISOString().slice(0, 10)}.xlsx` };
  }
}
