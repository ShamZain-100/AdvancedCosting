import { computeRateStats, selectCurrentRate } from './rates';

const e = (baseRate: string, baseQuantity: string, date: string) => ({ baseRate, baseQuantity, date });

describe('computeRateStats', () => {
  const entries = [e('100', '10', '2026-01-01'), e('110', '30', '2026-02-01'), e('90', '10', '2026-03-01')];

  it('computes min, max, last and averages', () => {
    const s = computeRateStats(entries);
    expect(s.min!.toString()).toBe('90');
    expect(s.max!.toString()).toBe('110');
    expect(s.last!.toString()).toBe('90');
    expect(s.simpleAverage!.toString()).toBe('100');
    // (100*10 + 110*30 + 90*10) / 50 = 5200 / 50
    expect(s.weightedAverage!.toString()).toBe('104');
  });

  it('uses the latest dated entry as "last", regardless of insertion order', () => {
    const s = computeRateStats([e('90', '1', '2026-03-01'), e('100', '1', '2026-01-01')]);
    expect(s.last!.toString()).toBe('90');
  });

  it('breaks date ties by later entry', () => {
    expect(computeRateStats([e('1', '1', '2026-01-01'), e('2', '1', '2026-01-01')]).last!.toString()).toBe('2');
  });

  it('handles empty input and zero-quantity weights without NaN', () => {
    expect(computeRateStats([]).count).toBe(0);
    const z = computeRateStats([e('10', '0', '2026-01-01'), e('20', '0', '2026-01-02')]);
    expect(z.weightedAverage!.toString()).toBe('15');
  });

  it('rounds half up to 4 decimals', () => {
    expect(computeRateStats([e('1', '1', '2026-01-01'), e('1.00005', '1', '2026-01-02')]).max!.toString()).toBe('1.0001');
  });
});

describe('selectCurrentRate', () => {
  const s = computeRateStats([e('100', '10', '2026-01-01'), e('120', '30', '2026-02-01')]);
  it('follows the configured method', () => {
    expect(selectCurrentRate('LAST_PURCHASE', s)!.toString()).toBe('120');
    expect(selectCurrentRate('SIMPLE_AVERAGE', s)!.toString()).toBe('110');
    expect(selectCurrentRate('WEIGHTED_AVERAGE', s)!.toString()).toBe('115');
  });
  it('never moves a MANUAL rate or an empty history', () => {
    expect(selectCurrentRate('MANUAL', s)).toBeNull();
    expect(selectCurrentRate('LAST_PURCHASE', computeRateStats([]))).toBeNull();
  });
});
