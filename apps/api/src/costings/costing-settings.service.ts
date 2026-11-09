import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CalcRules, DEFAULT_RULES } from '@costing/costing-engine';
import { calcRulesSchema } from '@costing/validators';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { parseOrThrow } from '../masters/master.service';
import type { AuthUser } from '../common/decorators';
import { ChangeBus } from '../recalc/change-bus';

/** Business calculation rules. Stored as a single row; the settings screen arrives in Phase 15. */
@Injectable()
export class CostingSettingsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, @Optional() private readonly bus?: ChangeBus) {}

  async getRules(): Promise<CalcRules> {
    const row = await this.prisma.costingSettings.findUnique({ where: { id: 1 } });
    const rules = { ...DEFAULT_RULES, ...((row?.rules as Partial<CalcRules> | undefined) ?? {}) };
    // a higher value saved before the limit existed must not produce figures the money columns cannot hold
    return { ...rules, decimals: Math.min(rules.decimals, 2) };
  }

  async setRules(actor: AuthUser, body: unknown): Promise<CalcRules> {
    const previous = await this.getRules();
    const rules = parseOrThrow(calcRulesSchema, { ...DEFAULT_RULES, ...previous, ...(body as object) }) as CalcRules;
    if (rules.decimals < 0) throw new BadRequestException('decimals must be 0 or more');
    await this.prisma.costingSettings.upsert({ where: { id: 1 }, update: { rules: rules as unknown as Prisma.InputJsonValue, updatedBy: actor.id }, create: { id: 1, rules: rules as unknown as Prisma.InputJsonValue, updatedBy: actor.id } });
    await this.audit.log({ userId: actor.id, action: 'update', entity: 'CostingSettings', entityId: '1', metadata: { ...rules } });
    if (JSON.stringify(previous) !== JSON.stringify(rules)) {
      await this.bus?.emit({ kind: 'RULES', sourceId: null, sourceName: 'Calculation rules', note: 'Calculation rules changed', actorId: actor.id });
    }
    return rules;
  }
}
