import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppSettings, DEFAULT_APP_SETTINGS, appSettingsSchema } from '@costing/validators';
import { DEFAULT_RULES } from '@costing/costing-engine';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { parseOrThrow } from '../masters/master.service';
import type { AuthUser } from '../common/decorators';

type Plain = Record<string, unknown>;
const isObj = (v: unknown): v is Plain => !!v && typeof v === 'object' && !Array.isArray(v);

/** Patch objects into the current document; arrays and scalars replace. Unknown keys are kept so the schema can reject them. */
export function deepMerge(base: Plain, patch: Plain): Plain {
  const out: Plain = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k] as Plain, v) : v;
  return out;
}

/**
 * Business settings: financial year, document numbering, defaults for new documents, print defaults and the approval
 * workflow. Stored as one validated JSON document; anything missing falls back to the built-in defaults, so adding a
 * setting later never breaks an existing installation.
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<AppSettings> {
    const row = await this.prisma.appSettings.findUnique({ where: { id: 1 } });
    const merged = deepMerge(DEFAULT_APP_SETTINGS as unknown as Plain, (row?.data as Plain | undefined) ?? {});
    const parsed = appSettingsSchema.safeParse(merged);
    return parsed.success ? parsed.data : DEFAULT_APP_SETTINGS; // a hand-edited bad row must never take the application down
  }

  /** Update one or more sections. The result must be valid as a whole, and referenced units must exist. */
  async update(actor: AuthUser, patch: unknown): Promise<AppSettings> {
    if (!isObj(patch) || !Object.keys(patch).length) throw new BadRequestException('Nothing to update');
    const next = parseOrThrow(appSettingsSchema, deepMerge(await this.get() as unknown as Plain, patch)) as AppSettings;
    const unitIds = [next.defaults.unitId, next.defaults.dimensionUnitId].filter((x): x is string => !!x);
    if (unitIds.length) {
      const found = await this.prisma.unit.count({ where: { id: { in: [...new Set(unitIds)] }, deletedAt: null } });
      if (found !== new Set(unitIds).size) throw new BadRequestException('defaults: A selected default unit does not exist');
    }
    const before = await this.get();
    await this.prisma.appSettings.upsert({
      where: { id: 1 }, update: { data: next as unknown as Prisma.InputJsonValue, updatedBy: actor.id },
      create: { id: 1, data: next as unknown as Prisma.InputJsonValue, updatedBy: actor.id },
    });
    const changed = Object.keys(next).filter((k) => JSON.stringify((next as unknown as Plain)[k]) !== JSON.stringify((before as unknown as Plain)[k]));
    await this.audit.log({ userId: actor.id, action: 'update', entity: 'AppSettings', entityId: '1', metadata: { sections: changed } });
    return next;
  }

  /** What every signed-in user needs to pre-fill forms and to know which workflow applies. Nothing sensitive. */
  async defaults() {
    const [s, row] = await Promise.all([this.get(), this.prisma.costingSettings.findUnique({ where: { id: 1 }, select: { rules: true, recalcMode: true } })]);
    const decimals = (row?.rules as { decimals?: number } | undefined)?.decimals ?? DEFAULT_RULES.decimals;
    return { defaults: s.defaults, print: s.print, approval: s.approval, financialYearStartMonth: s.financialYearStartMonth, rules: { decimals }, recalcMode: row?.recalcMode ?? 'CONFIRM' };
  }
}
