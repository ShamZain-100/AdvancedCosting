import { MasterService } from './master.service';
import { MASTERS } from './masters.config';
import { ChangeBus, MasterChange } from '../recalc/change-bus';

const expenses = MASTERS.find((m) => m.path === 'expenses')!;
const actor: any = { id: 'u1' };
const ID = '00000000-0000-4000-8000-000000000031';
const D = (v: string | number) => ({ toString: () => String(v) });
const row = (over: Record<string, any> = {}) => ({ id: ID, name: 'Factory rent', code: 'RENT', calculationMethod: 'FIXED', defaultValue: D(100), applyTiming: 'BEFORE_GST', isCompanyExpense: true, isActive: true, deletedAt: null, ...over });

function make(stored: Record<string, any>) {
  const events: MasterChange[] = [];
  const bus = new ChangeBus();
  bus.subscribe(async (c) => { events.push(c); });
  const prisma: any = {
    expense: { findFirst: jest.fn(async () => stored), create: jest.fn(async () => ({ id: ID })), update: jest.fn() },
    $transaction: jest.fn(async (fn: any) => fn({ expense: { create: jest.fn(async () => ({ id: ID })) } })),
  };
  return { svc: new MasterService(prisma, { log: jest.fn() } as any, bus), events, prisma };
}
const body = { name: 'Factory rent', code: 'RENT', calculationMethod: 'FIXED', defaultValue: '100', applyTiming: 'BEFORE_GST', isCompanyExpense: true };

describe('company expense changes are announced to the recalculation workflow', () => {
  it('creating an active company expense reaches every live costing', async () => {
    const { svc, events } = make(row());
    await svc.create(expenses, actor, body);
    expect(events).toEqual([expect.objectContaining({ kind: 'COMPANY_EXPENSE', sourceId: ID, sourceName: 'Factory rent', after: '100', actorId: 'u1' })]);
  });

  it('creating an ordinary expense announces nothing', async () => {
    const { svc, events } = make(row({ isCompanyExpense: false }));
    await svc.create(expenses, actor, { ...body, isCompanyExpense: false });
    expect(events).toEqual([]);
  });

  it('creating an inactive company expense announces nothing (it is not added to costings)', async () => {
    const { svc, events } = make(row({ isActive: false }));
    await svc.create(expenses, actor, { ...body, isActive: false });
    expect(events).toEqual([]);
  });

  it('deactivating and re-activating a company expense is announced', async () => {
    const { svc, events } = make(row());
    await svc.setStatus(expenses, actor, ID, false);
    await svc.setStatus(expenses, actor, ID, true);
    // re-activating compares against the stored (still active) row, so only the first call differs
    expect(events.map((e) => e.kind)).toEqual(['COMPANY_EXPENSE']);
  });

  it('activating a company expense that was inactive is announced', async () => {
    const { svc, events } = make(row({ isActive: false }));
    await svc.setStatus(expenses, actor, ID, true);
    expect(events.map((e) => e.kind)).toEqual(['COMPANY_EXPENSE']);
  });

  it('switching an ordinary expense on or off announces nothing', async () => {
    const { svc, events } = make(row({ isCompanyExpense: false }));
    await svc.setStatus(expenses, actor, ID, false);
    expect(events).toEqual([]);
  });

  it('editing the flag itself is announced (turning an expense into a company expense, and back)', () => {
    const w = expenses.watch!;
    expect(w(row({ isCompanyExpense: false }), row()).map((c) => c.kind)).toEqual(['COMPANY_EXPENSE']);
    expect(w(row(), row({ isCompanyExpense: false })).map((c) => c.kind)).toEqual(['COMPANY_EXPENSE']);
    expect(w(row(), row({ defaultValue: D('120') })).map((c) => c.kind)).toEqual(['COMPANY_EXPENSE']);
    expect(w(row(), row({ name: 'Renamed rent' }))).toEqual([]);
  });
});
