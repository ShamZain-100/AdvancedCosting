import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { resolvePermissions } from '../common/permissions';
import type { AuthUser } from '../common/decorators';

const ACCESS_TTL = '15m';
const REFRESH_TTL_MS = 7 * 24 * 3600 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
/**
 * Sign-in lockout, counted since the last good sign-in, unlock or password reset, within the window.
 * LOCKOUT_FAILURES blocks one address only, so a stranger guessing passwords cannot lock the real user out from another address.
 * LOCKOUT_ACCOUNT_FAILURES blocks the account everywhere, against guessing spread over many addresses.
 */
export const LOCKOUT_FAILURES = 5;
export const LOCKOUT_ACCOUNT_FAILURES = 30;
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
/** A refresh token replayed this long after it was rotated is treated as stolen; inside the window it is a harmless double-submit. */
export const REUSE_GRACE_MS = 30 * 1000;
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface ClientMeta { ip?: string; userAgent?: string }

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  hashPassword(p: string) { return bcrypt.hash(p, 12); }

  async login(email: string, password: string, meta: ClientMeta) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (user && (await this.isLockedOut(user.id, meta.ip))) {
      await this.audit.log({ userId: user.id, action: 'login_blocked', entity: 'User', entityId: user.id, ip: meta.ip });
      throw new HttpException('Too many failed sign-in attempts. Try again in 15 minutes.', HttpStatus.TOO_MANY_REQUESTS);
    }
    // Same error for unknown user / bad password / inactive, to avoid account enumeration.
    // A hash is always compared, so response time does not reveal whether the account exists.
    const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    const ok = user && user.isActive && passwordOk;
    if (!user || !ok) {
      await this.audit.log({ userId: user?.id, action: 'login_failed', entity: 'User', entityId: user?.id, ip: meta.ip });
      throw new UnauthorizedException('Invalid email or password');
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const tokens = await this.createSession(user.id, meta);
    await this.audit.log({ userId: user.id, action: 'login', entity: 'User', entityId: user.id, ip: meta.ip });
    return { ...tokens, mustChangePassword: user.mustChangePassword };
  }

  private async isLockedOut(userId: string, ip?: string): Promise<boolean> {
    const windowStart = new Date(Date.now() - LOCKOUT_WINDOW_MS);
    const reset = await this.prisma.auditLog.findFirst({
      where: { entity: 'User', entityId: userId, action: { in: ['login', 'login_unlocked', 'password_reset'] } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true },
    });
    const since = reset && reset.createdAt > windowStart ? reset.createdAt : windowStart;
    const failures = { userId, action: 'login_failed', createdAt: { gt: since } };
    if ((await this.prisma.auditLog.count({ where: { ...failures, ip } })) >= LOCKOUT_FAILURES) return true;
    return (await this.prisma.auditLog.count({ where: failures })) >= LOCKOUT_ACCOUNT_FAILURES;
  }

  private async createSession(userId: string, meta: ClientMeta) {
    const refreshToken = randomBytes(48).toString('base64url');
    const session = await this.prisma.session.create({
      data: {
        userId, refreshTokenHash: sha256(refreshToken), ip: meta.ip, userAgent: meta.userAgent?.slice(0, 255),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
    });
    const accessToken = await this.jwt.signAsync({ sub: userId, sid: session.id }, { expiresIn: ACCESS_TTL });
    return { accessToken, refreshToken };
  }

  /** Rotates the refresh token. Replaying an already-rotated token after the grace period signs the user out everywhere. */
  async refresh(refreshToken: string, meta: ClientMeta) {
    const session = await this.prisma.session.findUnique({ where: { refreshTokenHash: sha256(refreshToken) }, include: { user: true } });
    if (session?.revokedAt && Date.now() - session.revokedAt.getTime() > REUSE_GRACE_MS) {
      await this.prisma.session.updateMany({ where: { userId: session.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log({ userId: session.userId, action: 'refresh_token_reuse', entity: 'User', entityId: session.userId, ip: meta.ip });
    }
    if (!session || session.revokedAt || session.expiresAt < new Date() || !session.user.isActive) {
      throw new UnauthorizedException('Session expired');
    }
    await this.prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    return this.createSession(session.userId, meta);
  }

  async logout(sessionId: string) {
    await this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (user?.isActive) {
      const token = randomBytes(32).toString('base64url');
      await this.prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
      });
      // No mail transport until the settings phase: the link is logged for the operator.
      this.logger.warn(`Password reset token for ${user.email}: ${token}`);
      await this.audit.log({ userId: user.id, action: 'password_reset_requested', entity: 'User', entityId: user.id });
    }
    return { message: 'If the account exists, a reset link has been issued.' };
  }

  async resetPassword(token: string, newPassword: string) {
    const rec = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!rec || rec.usedAt || rec.expiresAt < new Date()) throw new BadRequestException('Invalid or expired reset token');
    const passwordHash = await this.hashPassword(newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: rec.userId }, data: { passwordHash, mustChangePassword: false } }),
      this.prisma.passwordResetToken.update({ where: { id: rec.id }, data: { usedAt: new Date() } }),
      this.prisma.session.updateMany({ where: { userId: rec.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.log({ userId: rec.userId, action: 'password_reset', entity: 'User', entityId: rec.userId });
    return { message: 'Password updated' };
  }

  async changePassword(user: AuthUser, currentPassword: string, newPassword: string) {
    const rec = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await bcrypt.compare(currentPassword, rec.passwordHash))) throw new BadRequestException('Current password is incorrect');
    if (await bcrypt.compare(newPassword, rec.passwordHash)) throw new BadRequestException('Choose a new password that is different from the current one');
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await this.hashPassword(newPassword), mustChangePassword: false } }),
      // keep the current session, drop the others
      this.prisma.session.updateMany({ where: { userId: user.id, revokedAt: null, id: { not: user.sessionId } }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.log({ userId: user.id, action: 'password_changed', entity: 'User', entityId: user.id });
    return { message: 'Password changed' };
  }

  /** Validates the access token + live session and loads effective permissions. */
  async authenticate(accessToken: string): Promise<AuthUser> {
    let payload: { sub: string; sid: string };
    try { payload = await this.jwt.verifyAsync(accessToken); } catch { throw new UnauthorizedException(); }
    const session = await this.prisma.session.findUnique({ where: { id: payload.sid } });
    if (!session || session.revokedAt || session.expiresAt < new Date()) throw new UnauthorizedException();
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
        permissions: { include: { permission: true } },
      },
    });
    if (!user || !user.isActive) throw new UnauthorizedException();
    const all = user.isSuperAdmin ? await this.allPermissionKeys() : [];
    const permissions = resolvePermissions({
      isSuperAdmin: user.isSuperAdmin,
      allPermissionKeys: all,
      rolePermissionKeys: user.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.key)),
      userAllowKeys: user.permissions.filter((p) => p.effect === 'ALLOW').map((p) => p.permission.key),
      userDenyKeys: user.permissions.filter((p) => p.effect === 'DENY').map((p) => p.permission.key),
    });
    return { id: user.id, email: user.email, name: user.name, isSuperAdmin: user.isSuperAdmin, sessionId: session.id, mustChangePassword: user.mustChangePassword, permissions };
  }

  private permissionKeys?: { keys: string[]; at: number };
  /** The permission catalogue only changes with a release, so super admins do not need it re-read on every request. */
  private async allPermissionKeys(): Promise<string[]> {
    if (!this.permissionKeys || Date.now() - this.permissionKeys.at > 60_000) {
      this.permissionKeys = { keys: (await this.prisma.permission.findMany({ select: { key: true } })).map((p) => p.key), at: Date.now() };
    }
    return this.permissionKeys.keys;
  }

  async touchSession(id: string) {
    await this.prisma.session.update({ where: { id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  }
}
