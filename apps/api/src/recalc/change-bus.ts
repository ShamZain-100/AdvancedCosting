import { Global, Injectable, Logger, Module } from '@nestjs/common';

/** DEALER: a price list dealer's margin or status changed (it reprices published costings, it never recalculates a costing). */
export type ChangeKind = 'ITEM_RATE' | 'ITEM_GST' | 'ITEM_UNITS' | 'LABOUR_RATE' | 'EXPENSE_DEFAULT' | 'COMPANY_EXPENSE' | 'RULES' | 'DEALER';

/** Something a costing is calculated from has changed (emitted after the change is committed). */
export interface MasterChange {
  kind: ChangeKind;
  sourceId: string | null;
  sourceName: string;
  /** old / new value for display and for the percentage change */
  before?: string | null;
  after?: string | null;
  note?: string;
  actorId?: string | null;
  /** the emitter has not recorded the rate change itself (edit of a master form), so the rate history should */
  logHistory?: boolean;
}

type Handler = (c: MasterChange) => Promise<void>;

/**
 * Tiny in-process event bus that keeps the places that change masters (item screen, purchase rates, settings)
 * independent of the recalculation workflow. A failing handler is logged and never fails the change itself.
 */
@Injectable()
export class ChangeBus {
  private readonly logger = new Logger(ChangeBus.name);
  private readonly handlers: Handler[] = [];

  subscribe(h: Handler) { this.handlers.push(h); }

  async emit(...changes: MasterChange[]) {
    for (const c of changes) {
      for (const h of this.handlers) {
        try { await h(c); } catch (e) { this.logger.error(`Handling ${c.kind} change of "${c.sourceName}" failed: ${(e as Error).message}`); }
      }
    }
  }
}

@Global()
@Module({ providers: [ChangeBus], exports: [ChangeBus] })
export class ChangeBusModule {}
