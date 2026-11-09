import { Injectable } from '@nestjs/common';

export interface RateImpactProvider {
  /** e.g. "live costing record(s)" */
  label: string;
  /** number of dependents that would be recalculated/flagged when this item's rate changes */
  countAffected(itemId: string): Promise<number>;
}

/**
 * Dependents of an item's purchase rate (live costings, derived price lists, quotations…)
 * register themselves here so the rate workflow can preview and record the blast radius
 * without depending on those modules.
 */
@Injectable()
export class RateImpactService {
  private readonly providers: RateImpactProvider[] = [];

  register(provider: RateImpactProvider) { this.providers.push(provider); }

  async measure(itemId: string) {
    const affected = await Promise.all(this.providers.map(async (p) => ({ label: p.label, count: await p.countAffected(itemId) })));
    return { affected, total: affected.reduce((s, a) => s + a.count, 0) };
  }
}
