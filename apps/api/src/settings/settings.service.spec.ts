import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DEFAULT_APP_SETTINGS } from '@costing/validators';
import { CostingsService } from '../costings/costings.service';
import { RateImpactService } from '../purchase-rates/rate-impact.service';
import { QuotationsService } from '../quotations/quotations.service';
import { NumberingService } from './numbering.service';
import { SettingsService, deepMerge } from './settings.service';
import { testSettings } from './test-helpers';

const actor = (id = 'u1', ...perms: string[]): any => ({ id, permissions: new Set(perms) });
const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function makeSettings(stored: unknown = null) {
  const prisma: any = {
    appSettings: { findUnique: jest.fn().mockResolvedValue(stored ? { data: stored } : null), upsert: jest.fn() },
    unit: { count: jest.fn().mockResolvedValue(1) },
    costingSettings: { findUnique: jest.fn().mockResolvedValue({ rules: { decimals: 3 }, recalcMode: 'AUTO' }) },
  };
  const audit: any = { log: jest.fn() };
  return { svc: new SettingsService(prisma, audit), prisma, audit };
}

describe('SettingsService', () => {
  it('falls back to the built-in defaults and fills in settings added after the row was saved', async () => {
    expect(await makeSettings().svc.get()).toEqual(DEFAULT_APP_SETTINGS);
    const partial = { financialYearStartMonth: 1, defaults: { gstPercent: '12' } };
    const s = await makeSettings(partial).svc.get();
    expect(s.financialYearStartMonth).toBe(1);
    expect(s.defaults.gstPercent).toBe('12');
    expect(s.defaults.quotationValidityDays).toBe(30); // from the defaults
  });

  it('a corrupt stored row never takes the application down', async () => {
    expect(await makeSettings({ financialYearStartMonth: 99 }).svc.get()).toEqual(DEFAULT_APP_SETTINGS);
  });

  it('updates one section, keeps the others, stores the whole validated document and audits which sections changed', async () => {
    const { svc, prisma, audit } = makeSettings();
    const r = await svc.update(actor(), { numbering: { quotation: { format: 'Q/{FY}/{SEQ:3}', reset: 'FINANCIAL_YEAR' } }, defaults: { markupPercent: '25' } });
    expect(r.numbering.quotation).toEqual({ format: 'Q/{FY}/{SEQ:3}', reset: 'FINANCIAL_YEAR' });
    expect(r.numbering.costing).toEqual(DEFAULT_APP_SETTINGS.numbering.costing);
    expect(r.defaults.markupPercent).toBe('25');
    expect(r.defaults.gstPercent).toBe('18');
    expect(prisma.appSettings.upsert.mock.calls[0][0].update.data).toEqual(r);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ entity: 'AppSettings', metadata: { sections: ['numbering', 'defaults'] } }));
  });

  it.each([
    ['empty patch', {}],
    ['not an object', 'x'],
    ['bad number format', { numbering: { costing: { format: 'NO-SEQUENCE' } } }],
    ['percentage over 100', { defaults: { gstPercent: '150' } }],
    ['unknown setting', { shoeSize: 9 }],
    ['unknown nested setting', { approval: { costing: { maybe: true } } }],
    ['month out of range', { financialYearStartMonth: 0 }],
  ])('rejects %s', async (_n, patch) => {
    const { svc, prisma } = makeSettings();
    await expect(svc.update(actor(), patch)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.appSettings.upsert).not.toHaveBeenCalled();
  });

  it('default units must exist; blank clears them', async () => {
    const { svc, prisma } = makeSettings({ defaults: { unitId: u(5) } });
    prisma.unit.count.mockResolvedValue(0);
    await expect(svc.update(actor(), { defaults: { dimensionUnitId: u(6) } })).rejects.toThrow(/default unit does not exist/);
    prisma.unit.count.mockResolvedValue(1);
    const r = await svc.update(actor(), { defaults: { unitId: '', dimensionUnitId: u(6) } });
    expect(r.defaults.unitId).toBeUndefined();
    expect(r.defaults.dimensionUnitId).toBe(u(6));
  });

  it('exposes only non-sensitive defaults to every signed-in user', async () => {
    const d = await makeSettings().svc.defaults();
    expect(Object.keys(d).sort()).toEqual(['approval', 'defaults', 'financialYearStartMonth', 'print', 'recalcMode', 'rules']);
    expect(d.rules).toEqual({ decimals: 3 });
    expect(d.recalcMode).toBe('AUTO');
  });

  it('deepMerge patches nested objects and replaces scalars', () => {
    expect(deepMerge({ a: { b: 1, c: 2 }, d: 1 }, { a: { c: 3 }, d: { e: 1 } })).toEqual({ a: { b: 1, c: 3 }, d: { e: 1 } });
  });
});

describe('NumberingService', () => {
  function make(taken: string[] = [], patch?: Parameters<typeof testSettings>[0]) {
    const { appSettings } = testSettings(patch);
    const counters = new Map<string, number>();
    const tx: any = { numberSequence: { upsert: jest.fn(async ({ where }: any) => { const v = (counters.get(where.key) ?? 0) + 1; counters.set(where.key, v); return { value: v }; }) } };
    const prisma: any = { numberSequence: { findUnique: jest.fn(async ({ where }: any) => (counters.has(where.key) ? { value: counters.get(where.key) } : null)) } };
    return { svc: new NumberingService(prisma, appSettings), tx, counters, isTaken: async (n: string) => taken.includes(n) };
  }
  const year = new Date().getUTCFullYear();

  it('numbers exactly as before by default and keeps the old counter names', async () => {
    const { svc, tx, counters, isTaken } = make();
    expect(await svc.next(tx, 'costing', new Date(Date.UTC(2026, 1, 1)), isTaken)).toBe('COST-2026-0001');
    expect(await svc.next(tx, 'costing', new Date(Date.UTC(2026, 5, 1)), isTaken)).toBe('COST-2026-0002');
    expect(await svc.next(tx, 'quotation', new Date(Date.UTC(2026, 5, 1)), isTaken)).toBe('QTN-2026-0001');
    expect(await svc.next(tx, 'priceList', new Date(Date.UTC(2026, 5, 1)), isTaken)).toBe('PL-2026-0001');
    expect([...counters.keys()].sort()).toEqual(['costing:2026', 'pricelist:2026', 'quotation:2026']);
  });

  it('restarts every year and every financial year when configured', async () => {
    const yearly = make();
    expect(await yearly.svc.next(yearly.tx, 'costing', new Date(Date.UTC(2026, 11, 31)), yearly.isTaken)).toBe('COST-2026-0001');
    expect(await yearly.svc.next(yearly.tx, 'costing', new Date(Date.UTC(2027, 0, 1)), yearly.isTaken)).toBe('COST-2027-0001');
    const fy = make([], (s) => { s.numbering.costing = { format: 'C/{FY}/{SEQ:3}', reset: 'FINANCIAL_YEAR' }; return s; });
    expect(await fy.svc.next(fy.tx, 'costing', new Date(Date.UTC(2026, 2, 31)), fy.isTaken)).toBe('C/2025-26/001');
    expect(await fy.svc.next(fy.tx, 'costing', new Date(Date.UTC(2026, 3, 1)), fy.isTaken)).toBe('C/2026-27/001');
    expect(await fy.svc.next(fy.tx, 'costing', new Date(Date.UTC(2026, 9, 1)), fy.isTaken)).toBe('C/2026-27/002');
    const never = make([], (s) => { s.numbering.quotation = { format: 'Q{SEQ:5}', reset: 'NEVER' }; return s; });
    expect(await never.svc.next(never.tx, 'quotation', new Date(Date.UTC(2026, 0, 1)), never.isTaken)).toBe('Q00001');
    expect(await never.svc.next(never.tx, 'quotation', new Date(Date.UTC(2031, 0, 1)), never.isTaken)).toBe('Q00002');
  });

  it('skips numbers that are already used, so changing the format or reset rule never creates a duplicate', async () => {
    const { svc, tx, isTaken } = make(['COST-2026-0001', 'COST-2026-0002', 'COST-2026-0003']);
    expect(await svc.next(tx, 'costing', new Date(Date.UTC(2026, 1, 1)), isTaken)).toBe('COST-2026-0004');
  });

  it('gives up with a clear error instead of looping forever', async () => {
    const { svc, tx } = make();
    await expect(svc.next(tx, 'costing', new Date(), async () => true)).rejects.toThrow(/free document number/);
  });

  it('previews the next number and examples without reserving anything', async () => {
    const { svc, tx, counters, isTaken } = make();
    await svc.next(tx, 'costing', new Date(), isTaken);
    const p = await svc.preview({ kind: 'costing', format: 'JOB/{YY}/{SEQ:3}', reset: 'YEARLY' });
    expect(p.next).toBe(`JOB/${String(year % 100).padStart(2, '0')}/002`);
    expect(p.examples).toHaveLength(2);
    expect(counters.get(`costing:${year}`)).toBe(1);
    await expect(svc.preview({ kind: 'costing', format: 'bad', reset: 'YEARLY' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('approval workflow settings', () => {
  function costings(patch: Parameters<typeof testSettings>[0], status: string, preparedById = 'maker') {
    const { appSettings, numbering } = testSettings(patch);
    const tx: any = { costing: { update: jest.fn(), findUniqueOrThrow: jest.fn().mockResolvedValue({ status: 'APPROVED', costingDate: new Date('2026-01-01'), groups: [], expenses: [] }) }, costingRevision: { create: jest.fn() } };
    const db: any = {
      costing: { findFirst: jest.fn().mockResolvedValue({ id: 'c1', status, version: 2, preparedById, costingNumber: 'COST-1' }) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    return { svc: new CostingsService(db, { log: jest.fn() } as any, {} as any, {} as any, new RateImpactService(), {} as any, numbering, appSettings), tx };
  }

  it('by default a costing must be submitted before it can be approved', async () => {
    const { svc } = costings((s) => s, 'DRAFT');
    await expect(svc.setStatus(actor('boss'), 'c1', 'approve', {})).rejects.toThrow(/Cannot approve a costing that is draft/);
  });

  it('when approval is not required an approver can approve a draft or rejected costing directly', async () => {
    for (const status of ['DRAFT', 'REJECTED']) {
      const { svc, tx } = costings((s) => { s.approval.costing.required = false; return s; }, status);
      expect(await svc.setStatus(actor('boss'), 'c1', 'approve', {})).toEqual({ id: 'c1', status: 'APPROVED' });
      expect(tx.costing.update.mock.calls[0][0].data).toMatchObject({ status: 'APPROVED', pricingMode: 'SNAPSHOT', approvedById: 'boss' });
    }
  });

  it('can forbid approving your own costing', async () => {
    const strict = (s: any) => { s.approval.costing.allowSelfApproval = false; return s; };
    const own = costings(strict, 'PENDING_APPROVAL', 'maker');
    await expect(own.svc.setStatus(actor('maker'), 'c1', 'approve', {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(own.tx.costing.update).not.toHaveBeenCalled();
    const other = costings(strict, 'PENDING_APPROVAL', 'maker');
    expect(await other.svc.setStatus(actor('checker'), 'c1', 'approve', {})).toEqual({ id: 'c1', status: 'APPROVED' });
    const lenient = costings((s) => s, 'PENDING_APPROVAL', 'maker');
    expect(await lenient.svc.setStatus(actor('maker'), 'c1', 'approve', {})).toEqual({ id: 'c1', status: 'APPROVED' });
  });

  function quotations(patch: Parameters<typeof testSettings>[0], status: string, preparedById = 'maker') {
    const { appSettings, numbering } = testSettings(patch);
    const tx: any = { quotation: { update: jest.fn() }, quotationShare: { updateMany: jest.fn() }, reviewFlag: { updateMany: jest.fn() } };
    const q = { id: 'q1', number: 'Q1', status, version: 1, preparedById, quotationDate: new Date('2026-01-01'), validUntil: new Date('2099-01-01'), deletedAt: null };
    const db: any = {
      quotation: { findFirst: jest.fn().mockResolvedValue(q), updateMany: jest.fn() },
      reviewFlag: { findMany: jest.fn().mockResolvedValue([]) }, quotationItem: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const svc = new QuotationsService(db, { log: jest.fn() } as any, {} as any, { mainImages: async () => new Map() } as any, {} as any, numbering, appSettings);
    jest.spyOn(svc, 'get').mockResolvedValue({ items: [] } as any);
    return { svc, tx };
  }

  it('quotations may be sent from draft by default, but not when approval is required', async () => {
    const open = quotations((s) => s, 'DRAFT');
    expect(await open.svc.transition(actor('maker', 'quotations:edit'), 'q1', 'send', {})).toEqual({ id: 'q1', status: 'SENT' });
    const required = quotations((s) => { s.approval.quotation.required = true; return s; }, 'DRAFT');
    await expect(required.svc.transition(actor('maker', 'quotations:edit'), 'q1', 'send', {})).rejects.toThrow(/approved before it is sent/);
    const approved = quotations((s) => { s.approval.quotation.required = true; return s; }, 'APPROVED');
    expect(await approved.svc.transition(actor('maker', 'quotations:edit'), 'q1', 'send', {})).toEqual({ id: 'q1', status: 'SENT' });
  });

  it('can forbid approving your own quotation', async () => {
    const strict = (s: any) => { s.approval.quotation.allowSelfApproval = false; return s; };
    const own = quotations(strict, 'PENDING', 'maker');
    await expect(own.svc.transition(actor('maker', 'quotations:edit', 'quotations:approve'), 'q1', 'approve', {})).rejects.toBeInstanceOf(ForbiddenException);
    const other = quotations(strict, 'PENDING', 'maker');
    expect(await other.svc.transition(actor('checker', 'quotations:edit', 'quotations:approve'), 'q1', 'approve', {})).toEqual({ id: 'q1', status: 'APPROVED' });
  });
});
