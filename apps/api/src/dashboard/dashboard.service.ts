import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../common/decorators';

const iso = (d: Date) => d.toISOString();

/**
 * Overview figures. Each section is returned only if the user may view the underlying data,
 * so the dashboard never leaks costs, rates or quotation values to people without access to them.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(actor: AuthUser) {
    const can = (p: string) => actor.permissions.has(p);
    const live = { deletedAt: null };
    const [costingGroups, quotationGroups, products, templates, suppliers, items, customers, pendingRecalculations] = await Promise.all([
      can('costing:view') ? this.prisma.costing.groupBy({ by: ['status'], where: live, _count: { _all: true } }) : null,
      can('quotations:view') ? this.prisma.quotation.groupBy({ by: ['status'], where: live, _count: { _all: true }, _sum: { grandTotal: true } }) : null,
      can('costing:view') ? this.prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(DISTINCT "productName") AS n FROM "Costing" WHERE "deletedAt" IS NULL` : null,
      can('templates:view') ? this.prisma.template.count({ where: { ...live, status: { not: 'ARCHIVED' } } }) : null,
      can('suppliers:view') ? this.prisma.supplier.count({ where: live }) : null,
      can('items:view') ? this.prisma.item.count({ where: live }) : null,
      can('customers:view') ? this.prisma.customer.count({ where: live }) : null,
      can('purchase_rates:view') ? this.prisma.recalculationBatch.count({ where: { status: { in: ['PENDING', 'PARTIAL'] } } }) : null,
    ]);
    const byStatus = <T extends { status: string; _count: { _all: number } }>(g: T[] | null) => (g ? Object.fromEntries(g.map((x) => [x.status, x._count._all])) : null);
    const total = (g: { _count: { _all: number } }[] | null) => (g ? g.reduce((s, x) => s + x._count._all, 0) : null);
    const q = quotationGroups ? Object.fromEntries(quotationGroups.map((x) => [x.status, x._count._all])) : null;

    const [recentCostings, recentRates, recentQuotations, recentActivity] = await Promise.all([
      can('costing:view')
        ? this.prisma.costing.findMany({ where: live, orderBy: { updatedAt: 'desc' }, take: 6, select: { id: true, costingNumber: true, productName: true, status: true, sellingPrice: true, updatedAt: true, preparedBy: { select: { name: true } } } })
        : null,
      can('purchase_rates:view')
        ? this.prisma.purchaseRateHistory.findMany({ orderBy: { changedAt: 'desc' }, take: 6, select: { id: true, oldRate: true, newRate: true, source: true, changedAt: true, item: { select: { id: true, name: true, code: true, unit: { select: { symbol: true } } } } } })
        : null,
      can('quotations:view')
        ? this.prisma.quotation.findMany({ where: live, orderBy: { updatedAt: 'desc' }, take: 6, select: { id: true, number: true, customerName: true, status: true, grandTotal: true, updatedAt: true } })
        : null,
      can('audit_logs:view')
        ? this.prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 8, select: { id: true, action: true, entity: true, createdAt: true, user: { select: { name: true } } } })
        : null,
    ]);

    return {
      generatedAt: iso(new Date()),
      counts: {
        products: products ? Number(products[0]?.n ?? 0) : null,
        costings: total(costingGroups),
        templates, suppliers, items, customers, pendingRecalculations,
        quotations: total(quotationGroups),
        pendingQuotations: q ? (q.PENDING ?? 0) + (q.SENT ?? 0) : null, // awaiting approval or a customer answer
        approvedQuotations: q ? q.APPROVED ?? 0 : null,
      },
      costingsByStatus: byStatus(costingGroups),
      quotationsByStatus: byStatus(quotationGroups),
      quotationValueByStatus: quotationGroups ? Object.fromEntries(quotationGroups.map((x) => [x.status, x._sum.grandTotal?.toString() ?? '0'])) : null,
      recentCostings: recentCostings?.map((c) => ({ ...c, sellingPrice: c.sellingPrice.toString() })) ?? null,
      recentRateChanges: recentRates?.map((r) => ({ ...r, oldRate: r.oldRate.toString(), newRate: r.newRate.toString() })) ?? null,
      recentQuotations: recentQuotations?.map((x) => ({ ...x, grandTotal: x.grandTotal.toString() })) ?? null,
      recentActivity,
    };
  }
}
