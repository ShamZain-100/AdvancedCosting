import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MAX_NUMBER_LENGTH, formatNumber, numberingPreviewSchema, sequenceKey, type NumberReset } from '@costing/validators';
import { PrismaService } from '../prisma/prisma.service';
import { parseOrThrow } from '../masters/master.service';
import { SettingsService } from './settings.service';

export type NumberKind = 'costing' | 'quotation' | 'priceList';
type Tx = Prisma.TransactionClient;
/** counter name prefixes, unchanged from before the settings existed so running counters continue */
const KEY_PREFIX: Record<NumberKind, string> = { costing: 'costing', quotation: 'quotation', priceList: 'pricelist' };

/**
 * Allocates document numbers from the configured format. Counters live in `NumberSequence`, one per kind and period
 * (year, financial year or never reset). Inside the caller's transaction a counter is incremented atomically; if the
 * formatted number is already taken (possible after the format or reset rule was changed) the counter moves on to the
 * next free number, so a settings change can never produce a duplicate.
 */
@Injectable()
export class NumberingService {
  constructor(private readonly prisma: PrismaService, private readonly settings: SettingsService) {}

  async next(tx: Tx, kind: NumberKind, date: Date, isTaken: (number: string) => Promise<boolean>): Promise<string> {
    const s = await this.settings.get();
    const cfg = s.numbering[kind];
    const key = sequenceKey(KEY_PREFIX[kind], cfg.reset, date, s.financialYearStartMonth);
    for (let attempt = 0; attempt < 200; attempt++) {
      const seq = await tx.numberSequence.upsert({ where: { key }, update: { value: { increment: 1 } }, create: { key, value: 1 } });
      const number = formatNumber(cfg.format, { date, seq: seq.value, fyStartMonth: s.financialYearStartMonth });
      if (number.length > MAX_NUMBER_LENGTH) throw new BadRequestException(`The ${kind} number format produces numbers longer than ${MAX_NUMBER_LENGTH} characters`);
      if (!(await isTaken(number))) return number;
    }
    throw new BadRequestException('Could not find a free document number; check the numbering settings');
  }

  /** What the next number would look like for a format (not reserved). */
  async preview(body: unknown) {
    const p = parseOrThrow(numberingPreviewSchema, body) as { kind: NumberKind; format: string; reset: NumberReset; financialYearStartMonth?: number };
    const s = await this.settings.get();
    const fy = p.financialYearStartMonth ?? s.financialYearStartMonth;
    const date = new Date();
    const key = sequenceKey(KEY_PREFIX[p.kind], p.reset, date, fy);
    const row = await this.prisma.numberSequence.findUnique({ where: { key } });
    const seq = (row?.value ?? 0) + 1;
    return {
      next: formatNumber(p.format, { date, seq, fyStartMonth: fy }),
      examples: [
        formatNumber(p.format, { date: new Date(Date.UTC(date.getUTCFullYear(), 0, 15)), seq: 1, fyStartMonth: fy }),
        formatNumber(p.format, { date: new Date(Date.UTC(date.getUTCFullYear(), 11, 15)), seq: 125, fyStartMonth: fy }),
      ],
      counter: key,
    };
  }
}
