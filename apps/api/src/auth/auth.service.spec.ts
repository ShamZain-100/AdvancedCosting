import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService, LOCKOUT_FAILURES, REUSE_GRACE_MS } from './auth.service';

function make(overrides: Record<string, any> = {}) {
  const prisma: any = {
    user: { findUnique: jest.fn(), update: jest.fn() },
    session: { create: jest.fn().mockResolvedValue({ id: 's1' }), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    passwordResetToken: { findUnique: jest.fn() },
    auditLog: { findFirst: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn(),
    ...overrides,
  };
  const jwt: any = { signAsync: jest.fn().mockResolvedValue('access'), verifyAsync: jest.fn() };
  const audit: any = { log: jest.fn() };
  return { svc: new AuthService(prisma, jwt, audit), prisma, jwt, audit };
}

describe('AuthService', () => {
  const hash = bcrypt.hashSync('Correct-Pass1', 4);

  it('logs in with valid credentials and creates a session', async () => {
    const { svc, prisma } = make();
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', isActive: true, passwordHash: hash, mustChangePassword: false });
    const r = await svc.login('A@x.com', 'Correct-Pass1', {});
    expect(r.accessToken).toBe('access');
    expect(r.refreshToken.length).toBeGreaterThan(40);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'a@x.com' } });
  });

  it.each([
    ['wrong password', { id: 'u1', isActive: true, passwordHash: hash }, 'nope'],
    ['inactive user', { id: 'u1', isActive: false, passwordHash: hash }, 'Correct-Pass1'],
    ['unknown user', null, 'Correct-Pass1'],
  ])('rejects %s with the same generic error', async (_n, user, pw) => {
    const { svc, prisma } = make();
    prisma.user.findUnique.mockResolvedValue(user);
    await expect(svc.login('a@x.com', pw, {})).rejects.toThrow(new UnauthorizedException('Invalid email or password'));
  });

  it('rejects a revoked or expired refresh token', async () => {
    const { svc, prisma } = make();
    prisma.session.findUnique.mockResolvedValue({ id: 's', revokedAt: new Date(), expiresAt: new Date(Date.now() + 1e6), user: { isActive: true } });
    await expect(svc.refresh('tok', {})).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rotates the refresh token (old session revoked, new one issued)', async () => {
    const { svc, prisma } = make();
    prisma.session.findUnique.mockResolvedValue({ id: 's', userId: 'u1', revokedAt: null, expiresAt: new Date(Date.now() + 1e6), user: { isActive: true } });
    await svc.refresh('tok', {});
    expect(prisma.session.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 's' } }));
    expect(prisma.session.create).toHaveBeenCalled();
  });

  it('rejects an expired or used reset token', async () => {
    const { svc, prisma } = make();
    prisma.passwordResetToken.findUnique.mockResolvedValue({ usedAt: new Date(), expiresAt: new Date(Date.now() + 1e6) });
    await expect(svc.resetPassword('t', 'NewPassw0rd')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('forgotPassword gives the same response for unknown emails', async () => {
    const { svc, prisma } = make();
    prisma.user.findUnique.mockResolvedValue(null);
    const r = await svc.forgotPassword('ghost@x.com');
    expect(r.message).toMatch(/If the account exists/);
  });

  it('never returns the password hash in tokens', async () => {
    const { svc, prisma } = make();
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', isActive: true, passwordHash: hash, mustChangePassword: true });
    expect(JSON.stringify(await svc.login('a@x.com', 'Correct-Pass1', {}))).not.toContain(hash);
  });

  describe('lockout', () => {
    it('counts failures per address, so another address can still sign in', async () => {
      const { svc, prisma } = make();
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', isActive: true, passwordHash: hash, mustChangePassword: false });
      prisma.auditLog.count.mockImplementation(async ({ where }: any) => (where.ip === '6.6.6.6' ? 5 : where.ip ? 0 : 5));
      await expect(svc.login('a@x.com', 'Correct-Pass1', { ip: '6.6.6.6' })).rejects.toThrow(/Too many/);
      await expect(svc.login('a@x.com', 'Correct-Pass1', { ip: '10.0.0.1' })).resolves.toMatchObject({ accessToken: 'access' });
    });

    it('blocks the whole account after many failures from many addresses', async () => {
      const { svc, prisma } = make();
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', isActive: true, passwordHash: hash, mustChangePassword: false });
      prisma.auditLog.count.mockImplementation(async ({ where }: any) => ('ip' in where ? 1 : 30));
      await expect(svc.login('a@x.com', 'Correct-Pass1', { ip: '10.0.0.1' })).rejects.toThrow(/Too many/);
    });

    it('an admin unlock or password reset starts the count again', async () => {
      const { svc, prisma } = make();
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', isActive: true, passwordHash: hash, mustChangePassword: false });
      const unlocked = new Date();
      prisma.auditLog.findFirst.mockResolvedValue({ createdAt: unlocked });
      prisma.auditLog.count.mockResolvedValue(0);
      await svc.login('a@x.com', 'Correct-Pass1', { ip: '10.0.0.1' });
      expect(prisma.auditLog.findFirst.mock.calls[0][0].where.action.in).toEqual(['login', 'login_unlocked', 'password_reset']);
      expect(prisma.auditLog.count.mock.calls[0][0].where.createdAt.gt).toBe(unlocked);
    });

    it(`blocks sign-in after ${LOCKOUT_FAILURES} failures, even with the right password`, async () => {
      const { svc, prisma, audit } = make();
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', isActive: true, passwordHash: hash });
      prisma.auditLog.count.mockResolvedValue(LOCKOUT_FAILURES);
      await expect(svc.login('a@x.com', 'Correct-Pass1', {})).rejects.toMatchObject({ status: 429 });
      expect(prisma.session.create).not.toHaveBeenCalled();
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'login_blocked' }));
    });

    it('allows sign-in below the limit', async () => {
      const { svc, prisma } = make();
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', isActive: true, passwordHash: hash, mustChangePassword: false });
      prisma.auditLog.count.mockResolvedValue(LOCKOUT_FAILURES - 1);
      await expect(svc.login('a@x.com', 'Correct-Pass1', {})).resolves.toBeDefined();
    });

    it('counts only failures after the last good sign-in', async () => {
      const { svc, prisma } = make();
      const lastGood = new Date(Date.now() - 60_000);
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', isActive: true, passwordHash: hash, mustChangePassword: false });
      prisma.auditLog.findFirst.mockResolvedValue({ createdAt: lastGood });
      await svc.login('a@x.com', 'Correct-Pass1', {});
      expect(prisma.auditLog.count).toHaveBeenCalledWith({ where: { userId: 'u1', action: 'login_failed', createdAt: { gt: lastGood } } });
    });

    it('unknown emails are never locked (and still pay for a hash comparison, so timing does not reveal the account)', async () => {
      const { svc, prisma } = make();
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(svc.login('ghost@x.com', 'whatever1', {})).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.auditLog.count).not.toHaveBeenCalled();
    });
  });

  describe('refresh token theft detection', () => {
    const rotated = (agoMs: number) => ({ id: 's', userId: 'u1', revokedAt: new Date(Date.now() - agoMs), expiresAt: new Date(Date.now() + 1e6), user: { isActive: true } });

    it('a token replayed long after rotation signs the user out everywhere', async () => {
      const { svc, prisma, audit } = make();
      prisma.session.findUnique.mockResolvedValue(rotated(REUSE_GRACE_MS + 5_000));
      await expect(svc.refresh('old', {})).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.session.updateMany).toHaveBeenCalledWith({ where: { userId: 'u1', revokedAt: null }, data: { revokedAt: expect.any(Date) } });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'refresh_token_reuse' }));
    });

    it('a double submit inside the grace period is just rejected', async () => {
      const { svc, prisma } = make();
      prisma.session.findUnique.mockResolvedValue(rotated(2_000));
      await expect(svc.refresh('old', {})).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.session.updateMany).not.toHaveBeenCalled();
    });
  });

  it('refuses a new password equal to the current one', async () => {
    const { svc, prisma } = make();
    prisma.user.findUniqueOrThrow = jest.fn().mockResolvedValue({ id: 'u1', passwordHash: hash });
    await expect(svc.changePassword({ id: 'u1', sessionId: 's1' } as any, 'Correct-Pass1', 'Correct-Pass1')).rejects.toThrow(/different/);
  });
});
