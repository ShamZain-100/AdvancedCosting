import { MaintenanceService } from './maintenance.service';

function make() {
  const del = () => jest.fn().mockResolvedValue({ count: 2 });
  const prisma: any = { session: { deleteMany: del() }, passwordResetToken: { deleteMany: del() }, quotationShare: { deleteMany: del() } };
  return { svc: new MaintenanceService(prisma), prisma };
}

describe('MaintenanceService', () => {
  const now = new Date('2026-06-01T00:00:00Z');

  it('removes only long-finished sessions, reset tokens and share links', async () => {
    const { svc, prisma } = make();
    expect(await svc.cleanup(now)).toEqual({ sessions: 2, resetTokens: 2, shareLinks: 2 });
    const days = (d: Date) => Math.round((now.getTime() - d.getTime()) / 86_400_000);
    const s = prisma.session.deleteMany.mock.calls[0][0].where.OR;
    expect([days(s[0].expiresAt.lt), days(s[1].revokedAt.lt)]).toEqual([30, 30]);
    const t = prisma.passwordResetToken.deleteMany.mock.calls[0][0].where.OR;
    expect([days(t[0].expiresAt.lt), days(t[1].usedAt.lt)]).toEqual([7, 7]);
    const q = prisma.quotationShare.deleteMany.mock.calls[0][0].where.OR;
    expect([days(q[0].expiresAt.lt), days(q[1].revokedAt.lt)]).toEqual([90, 90]);
  });

  it('never touches business records', async () => {
    const { svc, prisma } = make();
    await svc.cleanup(now);
    expect(Object.keys(prisma).sort()).toEqual(['passwordResetToken', 'quotationShare', 'session']);
  });

  it('does not schedule timers under test or when disabled', () => {
    const { svc } = make();
    svc.onModuleInit();
    expect((svc as unknown as { timers: unknown[] }).timers).toEqual([]);
  });
});
