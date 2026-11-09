import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/decorators';
import { ChangeBus } from '../recalc/change-bus';
import type { MasterConfig, SchemaLike } from './master.types';

export function parseOrThrow(schema: SchemaLike, value: unknown) {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  throw new BadRequestException({
    message: r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`),
    errors: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  });
}

/** The field names a schema accepts, looking through any wrapper around the object. */
function schemaKeys(schema: unknown): Set<string> {
  let s = schema as any;
  for (let depth = 0; s && depth < 5; depth++) {
    if (s.shape) return new Set(Object.keys(s.shape));
    s = s._def?.out ?? s._def?.schema ?? s._def?.innerType ?? s._def?.in;
  }
  return new Set();
}

/**
 * A form sends '' for a field the user emptied, and validation turns that into "not provided", which alone would leave the old
 * value in place. These are the fields to set to null instead: only ones the schema accepts (so nothing like deletedAt can be
 * reached) and only optional columns.
 */
function clearedFields(cfg: MasterConfig, body: unknown, parsed: unknown): Record<string, null> {
  if (!body || typeof body !== 'object') return {};
  const accepted = schemaKeys(cfg.schema);
  const fields = Prisma.dmmf.datamodel.models.find((m) => m.name === cfg.entity)?.fields ?? [];
  const nullable = new Set(fields.filter((f) => f.kind === 'scalar' && !f.isRequired).map((f) => f.name));
  const out: Record<string, null> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value === '' && accepted.has(key) && nullable.has(key) && (parsed as Record<string, unknown>)[key] === undefined) out[key] = null;
  }
  return out;
}

@Injectable()
export class MasterService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, @Optional() private readonly bus?: ChangeBus) {}

  private delegate(cfg: MasterConfig): any {
    return (this.prisma as any)[cfg.model];
  }

  async list(cfg: MasterConfig, q: Record<string, string | undefined>) {
    const where: Record<string, any> = { deletedAt: null };
    if (q.search) where.OR = cfg.searchFields.map((f) => ({ [f]: { contains: q.search, mode: 'insensitive' } }));
    if (q.status === 'active') where.isActive = true;
    if (q.status === 'inactive') where.isActive = false;
    for (const f of cfg.filters ?? []) if (q[f]) where[f] = q[f];

    const sortBy = cfg.sortable.includes(q.sortBy ?? '') ? q.sortBy! : cfg.sortable[0];
    const orderBy = { [sortBy]: q.sortDir === 'desc' ? 'desc' : 'asc' };
    const d = this.delegate(cfg);

    if (q.all === 'true') {
      if (!q.status) where.isActive = true; // dropdowns only offer active records
      const items = await d.findMany({ where, orderBy, take: 1000, include: cfg.include });
      return { items, total: items.length, page: 1, pageSize: items.length };
    }
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 25));
    const [items, total] = await Promise.all([
      d.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize, include: cfg.include }),
      d.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async get(cfg: MasterConfig, id: string) {
    const row = await this.delegate(cfg).findFirst({ where: { id, deletedAt: null }, include: cfg.include });
    if (!row) throw new NotFoundException(`${cfg.entity} not found`);
    return row;
  }

  /** Validate and normalise a payload without writing anything (also used by the Excel import). */
  async prepareCreate(cfg: MasterConfig, body: unknown) {
    const parsed = parseOrThrow(cfg.schema, body);
    await cfg.validate?.(parsed, { prisma: this.prisma });
    const { main, nested } = this.split(cfg, cfg.normalize ? cfg.normalize(parsed) : parsed);
    return { parsed, main, nested };
  }

  /** Insert a prepared payload using the caller's transaction. Returns the new id. */
  async insertPrepared(cfg: MasterConfig, tx: any, actor: AuthUser, p: Awaited<ReturnType<MasterService['prepareCreate']>>): Promise<string> {
    const row = await tx[cfg.model].create({ data: { ...p.main, createdBy: actor.id, updatedBy: actor.id } });
    await cfg.nested?.save(tx, row.id, p.nested, p.parsed);
    return row.id as string;
  }

  async create(cfg: MasterConfig, actor: AuthUser, body: unknown) {
    const prepared = await this.prepareCreate(cfg, body);
    try {
      const id = await this.prisma.$transaction((tx) => this.insertPrepared(cfg, tx, actor, prepared));
      await this.audit.log({ userId: actor.id, action: 'create', entity: cfg.entity, entityId: id, metadata: { name: prepared.main.name ?? null, code: prepared.main.code ?? null } });
      const created = await this.get(cfg, id);
      if (cfg.watchCreate && this.bus) await this.bus.emit(...cfg.watchCreate(created).map((c) => ({ ...c, actorId: actor.id })));
      return created;
    } catch (e) { throw this.mapError(cfg, e); }
  }

  async update(cfg: MasterConfig, actor: AuthUser, id: string, body: unknown) {
    const before = await this.get(cfg, id);
    const parsed = parseOrThrow(cfg.schema, body);
    await cfg.validate?.(parsed, { prisma: this.prisma, id });
    const { main, nested } = this.split(cfg, cfg.normalize ? cfg.normalize(parsed) : parsed);
    try {
      await this.prisma.$transaction(async (tx) => {
        await (tx as any)[cfg.model].update({ where: { id }, data: { ...main, ...clearedFields(cfg, body, parsed), updatedBy: actor.id } });
        await cfg.nested?.save(tx, id, nested, parsed);
      });
      await this.audit.log({ userId: actor.id, action: 'update', entity: cfg.entity, entityId: id, metadata: { name: main.name ?? null } });
      const after = await this.get(cfg, id);
      // tell the recalculation workflow what changed (after the commit, so it sees the new values)
      if (cfg.watch && this.bus) await this.bus.emit(...cfg.watch(before, after).map((c) => ({ ...c, actorId: actor.id })));
      return after;
    } catch (e) { throw this.mapError(cfg, e); }
  }

  async setStatus(cfg: MasterConfig, actor: AuthUser, id: string, isActive: unknown) {
    if (typeof isActive !== 'boolean') throw new BadRequestException('isActive must be a boolean');
    const before = await this.get(cfg, id);
    await this.delegate(cfg).update({ where: { id }, data: { isActive, updatedBy: actor.id } });
    await this.audit.log({ userId: actor.id, action: isActive ? 'activate' : 'deactivate', entity: cfg.entity, entityId: id });
    // switching a record on or off can change what costings follow (e.g. a company expense)
    if (cfg.watch && this.bus) await this.bus.emit(...cfg.watch(before, { ...before, isActive }).map((c) => ({ ...c, actorId: actor.id })));
    return { id, isActive };
  }

  /** Soft delete; refused while other active records still reference this one. */
  async remove(cfg: MasterConfig, actor: AuthUser, id: string) {
    const row = await this.get(cfg, id);
    const blockers: string[] = [];
    for (const ref of cfg.references) {
      const count = await (this.prisma as any)[ref.model].count({ where: { [ref.field]: id, ...(ref.soft ? { deletedAt: null } : {}), ...(ref.where ?? {}) } });
      if (count) blockers.push(`${count} ${ref.label}`);
    }
    if (blockers.length) {
      throw new ConflictException(`Cannot delete ${cfg.entity.toLowerCase()}: it is used by ${blockers.join(', ')}. Deactivate it instead.`);
    }
    const data: Record<string, unknown> = { deletedAt: new Date(), isActive: false, updatedBy: actor.id };
    // free the unique key so the code/symbol can be reused
    for (const key of ['code', 'symbol']) if (typeof row[key] === 'string') data[key] = `${row[key]}~deleted~${id.slice(0, 8)}`;
    await this.delegate(cfg).update({ where: { id }, data });
    await this.audit.log({ userId: actor.id, action: 'delete', entity: cfg.entity, entityId: id, metadata: { name: row.name ?? null } });
    return { id };
  }

  private split(cfg: MasterConfig, data: Record<string, any>) {
    const main = { ...data };
    const nested: Record<string, any[]> = {};
    for (const k of cfg.nested?.keys ?? []) { nested[k] = main[k] ?? []; delete main[k]; }
    return { main, nested };
  }

  private mapError(cfg: MasterConfig, e: unknown) {
    const err = e as { code?: string; meta?: { target?: string[] } };
    if (err.code === 'P2002') return new ConflictException(`${cfg.entity} ${err.meta?.target?.includes('symbol') ? 'symbol' : 'code'} already exists`);
    if (err.code === 'P2003') return new BadRequestException('A selected related record does not exist');
    return e;
  }
}
