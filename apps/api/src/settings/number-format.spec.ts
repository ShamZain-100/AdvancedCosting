import { DEFAULT_APP_SETTINGS, appSettingsSchema, financialYear, formatNumber, sequenceKey, validateNumberFormat } from '@costing/validators';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('number formats', () => {
  it('formats the default patterns exactly as before the settings existed', () => {
    expect(formatNumber('COST-{YYYY}-{SEQ:4}', { date: d('2026-02-01'), seq: 7, fyStartMonth: 4 })).toBe('COST-2026-0007');
    expect(formatNumber('QTN-{YYYY}-{SEQ:4}', { date: d('2026-12-31'), seq: 12345, fyStartMonth: 4 })).toBe('QTN-2026-12345'); // never truncated
  });

  it('supports year, month and financial year tokens', () => {
    const date = d('2026-02-15');
    expect(formatNumber('C/{FY}/{SEQ:3}', { date, seq: 5, fyStartMonth: 4 })).toBe('C/2025-26/005');
    expect(formatNumber('{YY}{MM}-{SEQ}', { date, seq: 5, fyStartMonth: 4 })).toBe('2602-5');
    expect(formatNumber('Q{FY}-{SEQ:2}', { date: d('2026-04-01'), seq: 1, fyStartMonth: 4 })).toBe('Q2026-27-01');
  });

  it('computes the financial year boundary correctly', () => {
    expect(financialYear(d('2026-03-31'), 4)).toEqual({ startYear: 2025, label: '2025-26' });
    expect(financialYear(d('2026-04-01'), 4)).toEqual({ startYear: 2026, label: '2026-27' });
    expect(financialYear(d('2026-06-30'), 1)).toEqual({ startYear: 2026, label: '2026' }); // January start = calendar year
    expect(financialYear(d('2099-12-31'), 4).label).toBe('2099-00'); // two-digit rollover
  });

  it('keeps the old counter key for yearly numbering so existing counters continue', () => {
    expect(sequenceKey('costing', 'YEARLY', d('2026-02-01'), 4)).toBe('costing:2026');
    expect(sequenceKey('costing', 'FINANCIAL_YEAR', d('2026-02-01'), 4)).toBe('costing:FY2025');
    expect(sequenceKey('costing', 'FINANCIAL_YEAR', d('2026-04-01'), 4)).toBe('costing:FY2026');
    expect(sequenceKey('quotation', 'NEVER', d('2030-01-01'), 4)).toBe('quotation:all');
  });

  it.each([
    ['COST-{YYYY}-{SEQ:4}', null], ['{SEQ}', null], ['AB', 'Use 3 to 30'], ['NOSEQ-{YYYY}', /exactly one \{SEQ\}/], ['{SEQ}{SEQ}', /exactly one/], ['X-{SEQ:0}', /width from 1 to 10/], ['X-{SEQ:11}', /width from 1 to 10/],
    ['X-{SEQ:4}-{BAD}', /Unknown or unfinished/], ['X-{SEQ:4}-{', /Unknown or unfinished/], ['X#{SEQ:4}', /only letters, digits/], ['<b>{SEQ:4}</b>', /only letters, digits|Unknown/], ['../{SEQ:4}', null],
    ['x'.repeat(31) + '{SEQ}', /Use 3 to 30/],
  ] as const)('validates %s', (format, expected) => {
    const msg = validateNumberFormat(format);
    if (expected === null) expect(msg).toBeNull();
    else if (typeof expected === 'string') expect(msg).toContain(expected);
    else expect(msg).toMatch(expected);
  });

  it('the longest accepted format still yields a reasonable number', () => {
    const f = 'ABCDEFGHIJKLMNOPQRST-{SEQ:10}';
    expect(validateNumberFormat(f)).toBeNull();
    expect(formatNumber(f, { date: d('2026-01-01'), seq: 1, fyStartMonth: 4 }).length).toBeLessThanOrEqual(40);
  });
});

describe('settings schema', () => {
  it('the built-in defaults are valid', () => {
    expect(appSettingsSchema.safeParse(DEFAULT_APP_SETTINGS).success).toBe(true);
  });
  const withPatch = (p: any) => appSettingsSchema.safeParse({ ...DEFAULT_APP_SETTINGS, ...p });

  it('rejects bad values and unknown keys', () => {
    expect(withPatch({ financialYearStartMonth: 13 }).success).toBe(false);
    expect(withPatch({ defaults: { ...DEFAULT_APP_SETTINGS.defaults, gstPercent: '120' } }).success).toBe(false);
    expect(withPatch({ defaults: { ...DEFAULT_APP_SETTINGS.defaults, quotationValidityDays: 0 } }).success).toBe(false);
    expect(withPatch({ numbering: { ...DEFAULT_APP_SETTINGS.numbering, costing: { format: 'NOSEQ', reset: 'YEARLY' } } }).success).toBe(false);
    expect(withPatch({ print: { orientation: 'sideways', costingMode: 'detailed' } }).success).toBe(false);
    expect(withPatch({ surprise: true }).success).toBe(false);
    expect(withPatch({ defaults: { ...DEFAULT_APP_SETTINGS.defaults, extra: 1 } }).success).toBe(false);
  });

  it('blank optional unit ids mean "none"', () => {
    const r = withPatch({ defaults: { ...DEFAULT_APP_SETTINGS.defaults, unitId: '', dimensionUnitId: '' } });
    expect(r.success && r.data.defaults.unitId).toBeUndefined();
  });
});
