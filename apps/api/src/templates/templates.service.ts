import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { convertQuantity, IncompatibleUnitsError, conversionsWithRules } from '@costing/costing-engine';
import { activeConversionRules } from '../common/conversion-rules';
import { duplicateTemplateSchema, templateSchema, templateStatusSchema, type TemplateInput } from '@costing/validators';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { parseOrThrow } from '../masters/master.service';
import type { AuthUser } from '../common/decorators';

type Tx = Prisma.TransactionClient;
const bad = (m: string) => new BadRequestException(m);

const TREE = {
  type: { select: { id: true, name: true } },
  groups: {
    orderBy: { sortOrder: 'asc' as const },
    include: {
      categories: { orderBy: { sortOrder: 'asc' as const }, include: { items: { orderBy: { sortOrder: 'asc' as const } } } },
      labour: { orderBy: { sortOrder: 'asc' as const } },
    },
  },
  expenses: { orderBy: { sortOrder: 'asc' as const }, include: { templateGroup: { select: { groupId: true } } } },
} satisfies Prisma.TemplateInclude;

type TemplateTree = Prisma.TemplateGetPayload<{ include: typeof TREE }>;
const str = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? undefined : v.toString());

@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  // ───────── validation ─────────

  /** Referential + hierarchy checks that Zod cannot do. Throws 400 with a path-prefixed message. */
  async validateTree(db: Tx | PrismaService, t: TemplateInput) {
    if (!(await db.type.findFirst({ where: { id: t.typeId, deletedAt: null } }))) throw bad('typeId: Selected type does not exist');

    const groupIds = t.groups.map((g) => g.groupId);
    const categoryIds = t.groups.flatMap((g) => g.categories.map((c) => c.categoryId));
    const itemIds = t.groups.flatMap((g) => g.categories.flatMap((c) => c.items.map((i) => i.itemId)));
    const labourIds = t.groups.flatMap((g) => g.labour.map((l) => l.labourId));
    const unitIds = [...new Set([...t.groups.flatMap((g) => [...g.categories.flatMap((c) => c.items.map((i) => i.unitId)), ...g.labour.flatMap((l) => (l.unitId ? [l.unitId] : []))]) ])];

    const [conversionRules, groups, categories, items, labour, expenses, units] = await Promise.all([
      activeConversionRules(db),
      db.itemGroup.findMany({ where: { id: { in: groupIds }, deletedAt: null } }),
      db.itemCategory.findMany({ where: { id: { in: categoryIds }, deletedAt: null } }),
      db.item.findMany({ where: { id: { in: itemIds }, deletedAt: null }, include: { unit: true, unitConversions: { include: { unit: true } } } }),
      db.labour.findMany({ where: { id: { in: labourIds }, deletedAt: null } }),
      db.expense.findMany({ where: { id: { in: t.expenses.map((e) => e.expenseId) }, deletedAt: null } }),
      db.unit.findMany({ where: { id: { in: unitIds }, deletedAt: null } }),
    ]);
    const by = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));
    const G = by(groups), C = by(categories), I = by(items), L = by(labour), E = by(expenses), U = by(units);

    t.groups.forEach((g, gi) => {
      const p = `groups.${gi}`;
      const group = G.get(g.groupId);
      if (!group) throw bad(`${p}.groupId: Group does not exist`);
      if (group.typeId !== t.typeId) throw bad(`${p}.groupId: Group "${group.name}" does not belong to the template's type`);
      g.categories.forEach((c, ci) => {
        const cp = `${p}.categories.${ci}`;
        const cat = C.get(c.categoryId);
        if (!cat) throw bad(`${cp}.categoryId: Category does not exist`);
        if (cat.groupId !== g.groupId) throw bad(`${cp}.categoryId: Category "${cat.name}" does not belong to group "${group.name}"`);
        c.items.forEach((it, ii) => {
          const ip = `${cp}.items.${ii}`;
          const item = I.get(it.itemId);
          if (!item) throw bad(`${ip}.itemId: Item does not exist`);
          if (item.categoryId !== c.categoryId) throw bad(`${ip}.itemId: Item "${item.name}" does not belong to category "${cat.name}"`);
          const unit = it.unitId === item.unitId ? item.unit : U.get(it.unitId);
          if (!unit) throw bad(`${ip}.unitId: Unit does not exist`);
          try {
            const ref = (u: typeof unit) => ({ id: u.id, unitType: u.unitType, baseFactor: u.baseFactor?.toString() ?? null });
            convertQuantity(1, ref(unit), ref(item.unit), { baseUnitId: item.unitId, conversions: conversionsWithRules({ id: item.id, baseUnitId: item.unitId, conversions: item.unitConversions.map((x) => ({ unitId: x.unitId, conversionValue: x.conversionValue.toString() })) }, conversionRules) });
          } catch (e) {
            if (e instanceof IncompatibleUnitsError) throw bad(`${ip}.unitId: ${unit.symbol} cannot be converted to ${item.name}'s base unit ${item.unit.symbol}`);
            throw e;
          }
        });
      });
      g.labour.forEach((l, li) => {
        if (!L.has(l.labourId)) throw bad(`${p}.labour.${li}.labourId: Labour does not exist`);
        if (l.unitId && !U.has(l.unitId)) throw bad(`${p}.labour.${li}.unitId: Unit does not exist`);
      });
    });
    t.expenses.forEach((e, i) => { if (!E.has(e.expenseId)) throw bad(`expenses.${i}.expenseId: Expense does not exist`); });
  }

  // ───────── persistence ─────────

  private async writeTree(tx: Tx, id: string, t: TemplateInput) {
    await tx.templateExpense.deleteMany({ where: { templateId: id } });
    await tx.templateGroup.deleteMany({ where: { templateId: id } }); // cascades categories, items, labour
    for (const [gi, g] of t.groups.entries()) {
      await tx.templateGroup.create({
        data: {
          templateId: id, groupId: g.groupId, sortOrder: gi, wastagePercent: g.wastagePercent ?? null,
          categories: {
            create: g.categories.map((c, ci) => ({
              categoryId: c.categoryId, sortOrder: ci, wastagePercent: c.wastagePercent ?? null,
              items: { create: c.items.map((i, ii) => ({ itemId: i.itemId, quantity: i.quantity, unitId: i.unitId, wastagePercent: i.wastagePercent ?? null, notes: i.notes ?? null, sortOrder: ii })) },
            })),
          },
          labour: { create: g.labour.map((l, li) => ({ labourId: l.labourId, quantity: l.quantity, unitId: l.unitId ?? null, rate: l.rate ?? null, sortOrder: li })) },
        },
      });
    }
    if (t.expenses.length) {
      const tgs = await tx.templateGroup.findMany({ where: { templateId: id }, select: { id: true, groupId: true } });
      const tgByGroup = new Map(tgs.map((x) => [x.groupId, x.id]));
      await tx.templateExpense.createMany({
        data: t.expenses.map((e, i) => ({
          templateId: id, expenseId: e.expenseId, templateGroupId: e.groupId ? tgByGroup.get(e.groupId)! : null,
          calculationMethod: e.calculationMethod ?? null, value: e.value ?? null, sortOrder: i,
        })),
      });
    }
  }

  private async snapshot(tx: Tx, id: string, version: number, actorId: string, note?: string) {
    const full = await tx.template.findUniqueOrThrow({ where: { id }, include: TREE });
    await tx.templateVersion.create({ data: { templateId: id, version, snapshot: this.toPayload(full) as unknown as Prisma.InputJsonValue, note: note ?? null, createdBy: actorId } });
  }

  /** Form-shaped representation (master ids) – what the editor edits and what a snapshot stores. */
  toPayload(t: TemplateTree) {
    return {
      name: t.name, code: t.code, typeId: t.typeId, description: t.description ?? '',
      wastagePercent: str(t.wastagePercent)!, gstPercent: str(t.gstPercent)!, markupPercent: str(t.markupPercent)!,
      status: t.status === 'ARCHIVED' ? 'INACTIVE' : t.status,
      groups: t.groups.map((g) => ({
        groupId: g.groupId, wastagePercent: str(g.wastagePercent) ?? '',
        categories: g.categories.map((c) => ({
          categoryId: c.categoryId, wastagePercent: str(c.wastagePercent) ?? '',
          items: c.items.map((i) => ({ itemId: i.itemId, quantity: str(i.quantity)!, unitId: i.unitId, wastagePercent: str(i.wastagePercent) ?? '', notes: i.notes ?? '' })),
        })),
        labour: g.labour.map((l) => ({ labourId: l.labourId, quantity: str(l.quantity)!, unitId: l.unitId ?? '', rate: str(l.rate) ?? '' })),
      })),
      expenses: t.expenses.map((e) => ({ expenseId: e.expenseId, groupId: e.templateGroup?.groupId ?? '', calculationMethod: e.calculationMethod ?? '', value: str(e.value) ?? '' })),
    };
  }

  private mapError(e: unknown) {
    if ((e as { code?: string }).code === 'P2002') return new ConflictException('Template code already exists');
    return e;
  }

  // ───────── operations ─────────

  /** Create inside the caller's transaction (used by the Excel import). */
  async createWithin(tx: Tx, actor: AuthUser, t: TemplateInput): Promise<string> {
    const row = await tx.template.create({
      data: {
        name: t.name, code: t.code, typeId: t.typeId, description: t.description ?? null, wastagePercent: t.wastagePercent,
        gstPercent: t.gstPercent, markupPercent: t.markupPercent, status: t.status, createdBy: actor.id, updatedBy: actor.id,
      },
    });
    await this.writeTree(tx, row.id, t);
    await this.snapshot(tx, row.id, 1, actor.id, 'Created');
    return row.id;
  }

  async create(actor: AuthUser, body: unknown) {
    const t = parseOrThrow(templateSchema, body) as TemplateInput;
    await this.validateTree(this.prisma, t);
    try {
      const id = await this.prisma.$transaction((tx) => this.createWithin(tx, actor, t));
      await this.audit.log({ userId: actor.id, action: 'create', entity: 'Template', entityId: id, metadata: { code: t.code } });
      return this.get(id);
    } catch (e) { throw this.mapError(e); }
  }

  async update(actor: AuthUser, id: string, body: unknown) {
    const existing = await this.mustFind(id);
    if (existing.status === 'ARCHIVED') throw bad('Archived templates are read-only. Restore the template to edit it.');
    const t = parseOrThrow(templateSchema, body) as TemplateInput;
    await this.validateTree(this.prisma, t);
    try {
      await this.prisma.$transaction(async (tx) => {
        const version = existing.version + 1;
        await tx.template.update({
          where: { id },
          data: {
            name: t.name, code: t.code, typeId: t.typeId, description: t.description ?? null, wastagePercent: t.wastagePercent,
            gstPercent: t.gstPercent, markupPercent: t.markupPercent, status: t.status, version, updatedBy: actor.id,
          },
        });
        await this.writeTree(tx, id, t);
        await this.snapshot(tx, id, version, actor.id);
      });
      await this.audit.log({ userId: actor.id, action: 'update', entity: 'Template', entityId: id, metadata: { version: existing.version + 1 } });
      return this.get(id);
    } catch (e) { throw this.mapError(e); }
  }

  /** Copy a template (new code/name, version 1). The copy is independent of the original. */
  async duplicate(actor: AuthUser, id: string, body: unknown) {
    const { name, code } = parseOrThrow(duplicateTemplateSchema, body) as { name: string; code: string };
    const source = await this.mustFind(id, true);
    const payload = this.toPayload(source) as unknown as TemplateInput;
    return this.create(actor, { ...payload, name, code, status: 'ACTIVE' });
  }

  async setStatus(actor: AuthUser, id: string, body: unknown) {
    const { status } = parseOrThrow(templateStatusSchema, body) as { status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED' };
    await this.mustFind(id);
    await this.prisma.template.update({ where: { id }, data: { status, updatedBy: actor.id } });
    await this.audit.log({ userId: actor.id, action: status === 'ARCHIVED' ? 'archive' : 'set_status', entity: 'Template', entityId: id, metadata: { status } });
    return { id, status };
  }

  /** Soft delete. Costings copy template data, so deletion never alters them. */
  async remove(actor: AuthUser, id: string) {
    const t = await this.mustFind(id);
    await this.prisma.template.update({ where: { id }, data: { deletedAt: new Date(), status: 'ARCHIVED', code: `${t.code}~deleted~${id.slice(0, 8)}`, updatedBy: actor.id } });
    await this.audit.log({ userId: actor.id, action: 'delete', entity: 'Template', entityId: id, metadata: { name: t.name } });
    return { id };
  }

  async get(id: string) {
    const t = await this.mustFind(id, true);
    return {
      id: t.id, version: t.version, status: t.status, type: t.type, createdAt: t.createdAt, updatedAt: t.updatedAt,
      payload: this.toPayload(t),
    };
  }

  async list(q: Record<string, string | undefined>) {
    const where: Prisma.TemplateWhereInput = { deletedAt: null };
    if (q.search) where.OR = [{ name: { contains: q.search, mode: 'insensitive' } }, { code: { contains: q.search, mode: 'insensitive' } }];
    if (q.typeId) where.typeId = q.typeId;
    if (q.status) where.status = q.status as never;
    else if (q.all === 'true') where.status = 'ACTIVE'; // pickers (new costing) only offer active templates
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = q.all === 'true' ? 1000 : Math.min(200, Math.max(1, Number(q.pageSize) || 25));
    const sortBy = ['name', 'code', 'updatedAt', 'version'].includes(q.sortBy ?? '') ? q.sortBy! : 'name';
    const [rows, total] = await Promise.all([
      this.prisma.template.findMany({
        where, orderBy: { [sortBy]: q.sortDir === 'desc' ? 'desc' : 'asc' }, skip: (page - 1) * pageSize, take: pageSize,
        include: { type: { select: { id: true, name: true } }, _count: { select: { groups: true, expenses: true } } },
      }),
      this.prisma.template.count({ where }),
    ]);
    const counts = await this.itemCounts(rows.map((r) => r.id));
    return { items: rows.map(({ _count, ...r }) => ({ ...r, groupCount: _count.groups, itemCount: counts.get(r.id) ?? 0 })), total, page, pageSize };
  }

  /** Number of item lines per template, counted by the database in one query. */
  private async itemCounts(ids: string[]) {
    const m = new Map<string, number>();
    if (!ids.length) return m;
    const rows = await this.prisma.$queryRaw<{ templateId: string; n: bigint }[]>(Prisma.sql`
      SELECT tg."templateId" AS "templateId", COUNT(*) AS n
      FROM "TemplateItem" ti
      JOIN "TemplateCategory" tc ON tc."id" = ti."templateCategoryId"
      JOIN "TemplateGroup" tg ON tg."id" = tc."templateGroupId"
      WHERE tg."templateId" IN (${Prisma.join(ids)})
      GROUP BY tg."templateId"`);
    for (const r of rows) m.set(r.templateId, Number(r.n));
    return m;
  }

  async versions(id: string) {
    await this.mustFind(id);
    const rows = await this.prisma.templateVersion.findMany({ where: { templateId: id }, orderBy: { version: 'desc' }, select: { version: true, note: true, createdAt: true, createdBy: true } });
    const ids = [...new Set(rows.map((r) => r.createdBy).filter((x): x is string => !!x))];
    const users = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
    const names = new Map(users.map((u) => [u.id, u.name]));
    return rows.map((r) => ({ ...r, createdByName: r.createdBy ? (names.get(r.createdBy) ?? null) : null }));
  }

  async version(id: string, version: number) {
    const v = await this.prisma.templateVersion.findUnique({ where: { templateId_version: { templateId: id, version } } });
    if (!v) throw new NotFoundException('Version not found');
    return v;
  }

  private async mustFind(id: string): Promise<Prisma.TemplateGetPayload<{}>>;
  private async mustFind(id: string, withTree: true): Promise<TemplateTree>;
  private async mustFind(id: string, withTree?: boolean) {
    const t = await this.prisma.template.findFirst({ where: { id, deletedAt: null }, ...(withTree ? { include: TREE } : {}) });
    if (!t) throw new NotFoundException('Template not found');
    return t;
  }
}
