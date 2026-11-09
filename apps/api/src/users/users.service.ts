import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { resolvePermissions } from '../common/permissions';
import type { AuthUser } from '../common/decorators';
import { CreateUserDto, UpdateUserDto, UserPermissionEntry } from './users.dto';

const SAFE = {
  id: true, email: true, name: true, mobile: true, isActive: true, isSuperAdmin: true,
  mustChangePassword: true, lastLoginAt: true, createdAt: true,
  roles: { select: { role: { select: { id: true, name: true } } } },
  dealers: { select: { dealer: { select: { id: true, name: true, code: true } } } },
} satisfies Prisma.UserSelect;

interface UserAccess { isSuperAdmin: boolean; roleKeys: string[]; allowKeys: string[]; denyKeys: string[] }

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  private flat<T extends { roles: { role: unknown }[]; dealers: { dealer: unknown }[] }>(u: T) {
    return { ...u, roles: u.roles.map((r) => r.role), dealers: u.dealers.map((g) => g.dealer) };
  }

  async list(q: { page: number; pageSize: number; search?: string }) {
    const where: Prisma.UserWhereInput = q.search
      ? { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { email: { contains: q.search, mode: 'insensitive' } }] }
      : {};
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({ where, select: SAFE, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.user.count({ where }),
    ]);
    return { items: rows.map((r) => this.flat(r)), total, page: q.page, pageSize: q.pageSize };
  }

  async get(id: string) {
    const u = await this.prisma.user.findUnique({
      where: { id },
      select: { ...SAFE, permissions: { select: { effect: true, permission: { select: { key: true } } } } },
    });
    if (!u) throw new NotFoundException('User not found');
    const { permissions, ...rest } = this.flat(u);
    return { ...rest, overrides: permissions.map((p) => ({ key: p.permission.key, effect: p.effect })) };
  }

  async create(actor: AuthUser, dto: CreateUserDto) {
    const email = dto.email.toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) throw new ConflictException('Email already in use');
    this.assertCanGrant(actor, await this.roleKeys(dto.roleIds ?? []));
    await this.assertDealers(dto.dealerIds ?? []);
    const user = await this.prisma.user.create({
      data: {
        email, name: dto.name, mobile: dto.mobile, passwordHash: await this.auth.hashPassword(dto.password), mustChangePassword: true,
        roles: { create: (dto.roleIds ?? []).map((roleId) => ({ roleId })) },
        dealers: { create: (dto.dealerIds ?? []).map((dealerId) => ({ dealerId })) },
      },
      select: SAFE,
    });
    await this.audit.log({ userId: actor.id, action: 'create', entity: 'User', entityId: user.id, metadata: { email } });
    return this.flat(user);
  }

  async update(actor: AuthUser, id: string, dto: UpdateUserDto) {
    await this.assertCanManage(actor, id);
    if (dto.email) {
      dto.email = dto.email.toLowerCase();
      const other = await this.prisma.user.findUnique({ where: { email: dto.email } });
      if (other && other.id !== id) throw new ConflictException('Email already in use');
    }
    const user = await this.prisma.user.update({ where: { id }, data: dto, select: SAFE }).catch(() => { throw new NotFoundException('User not found'); });
    await this.audit.log({ userId: actor.id, action: 'update', entity: 'User', entityId: id, metadata: { ...dto } });
    return this.flat(user);
  }

  async setStatus(actor: AuthUser, id: string, isActive: boolean) {
    if (id === actor.id && !isActive) throw new BadRequestException('You cannot deactivate your own account');
    const target = await this.mustFind(id);
    if (target.isSuperAdmin && !isActive && !actor.isSuperAdmin) throw new ForbiddenException('Only a super admin can deactivate a super admin');
    await this.assertCanManage(actor, id);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { isActive } }),
      ...(isActive ? [] : [this.prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } })]),
    ]);
    await this.audit.log({ userId: actor.id, action: isActive ? 'activate' : 'deactivate', entity: 'User', entityId: id });
    return { id, isActive };
  }

  async resetPassword(actor: AuthUser, id: string, newPassword: string) {
    const target = await this.mustFind(id);
    if (target.isSuperAdmin && !actor.isSuperAdmin) throw new ForbiddenException('Only a super admin can reset a super admin password');
    await this.assertCanManage(actor, id);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { passwordHash: await this.auth.hashPassword(newPassword), mustChangePassword: true } }),
      this.prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.log({ userId: actor.id, action: 'admin_reset_password', entity: 'User', entityId: id });
    return { message: 'Password reset; user must change it at next login' };
  }

  /** Clears a sign-in lockout at once, rather than waiting for the window to pass. */
  async unlock(actor: AuthUser, id: string) {
    await this.mustFind(id);
    await this.assertCanManage(actor, id);
    await this.audit.log({ userId: actor.id, action: 'login_unlocked', entity: 'User', entityId: id });
    return { id };
  }

  async setRoles(actor: AuthUser, id: string, roleIds: string[]) {
    await this.mustFind(id);
    const found = await this.prisma.role.count({ where: { id: { in: roleIds } } });
    if (found !== roleIds.length) throw new BadRequestException('Unknown role id');
    this.assertNotSelf(actor, id);
    const current = await this.assertCanManage(actor, id);
    this.assertCanGrant(actor, this.gained(current, { ...current, roleKeys: await this.roleKeys(roleIds) }));
    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { userId: id } }),
      this.prisma.userRole.createMany({ data: roleIds.map((roleId) => ({ userId: id, roleId })) }),
    ]);
    await this.audit.log({ userId: actor.id, action: 'set_roles', entity: 'User', entityId: id, metadata: { roleIds } });
    return this.get(id);
  }

  /** The price list dealers a user belongs to. A dealer user sees only these dealers' prices. */
  async setDealers(actor: AuthUser, id: string, dealerIds: string[]) {
    await this.mustFind(id);
    await this.assertDealers(dealerIds);
    this.assertNotSelf(actor, id);
    await this.assertCanManage(actor, id);
    await this.prisma.$transaction([
      this.prisma.userPriceListDealer.deleteMany({ where: { userId: id } }),
      this.prisma.userPriceListDealer.createMany({ data: dealerIds.map((dealerId) => ({ userId: id, dealerId })) }),
    ]);
    await this.audit.log({ userId: actor.id, action: 'set_dealers', entity: 'User', entityId: id, metadata: { dealerIds } });
    return this.get(id);
  }

  private async assertDealers(dealerIds: string[]) {
    if (!dealerIds.length) return;
    const found = await this.prisma.priceListDealer.count({ where: { id: { in: dealerIds }, deletedAt: null } });
    if (found !== dealerIds.length) throw new BadRequestException('Unknown price list dealer');
  }

  async setOverrides(actor: AuthUser, id: string, overrides: UserPermissionEntry[]) {
    await this.mustFind(id);
    const perms = await this.prisma.permission.findMany({ where: { key: { in: overrides.map((o) => o.key) } } });
    const byKey = new Map(perms.map((p) => [p.key, p.id]));
    const unknown = overrides.filter((o) => !byKey.has(o.key));
    if (unknown.length) throw new BadRequestException(`Unknown permission: ${unknown[0].key}`);
    this.assertNotSelf(actor, id);
    const current = await this.assertCanManage(actor, id);
    this.assertCanGrant(actor, this.gained(current, {
      ...current, allowKeys: overrides.filter((o) => o.effect === 'ALLOW').map((o) => o.key), denyKeys: overrides.filter((o) => o.effect === 'DENY').map((o) => o.key),
    }));
    await this.prisma.$transaction([
      this.prisma.userPermission.deleteMany({ where: { userId: id } }),
      this.prisma.userPermission.createMany({ data: overrides.map((o) => ({ userId: id, permissionId: byKey.get(o.key)!, effect: o.effect })) }),
    ]);
    await this.audit.log({ userId: actor.id, action: 'set_permissions', entity: 'User', entityId: id, metadata: { overrides: overrides.map((o) => ({ ...o })) } });
    return this.get(id);
  }

  activity(id: string, page: number, pageSize: number) {
    return this.audit.list({ page, pageSize, userId: id });
  }

  // ───────── nobody can give away, or take over, access they do not hold themselves ─────────

  private assertNotSelf(actor: AuthUser, id: string) {
    if (id === actor.id && !actor.isSuperAdmin) throw new ForbiddenException('You cannot change your own access');
  }

  private assertCanGrant(actor: AuthUser, keys: Iterable<string>) {
    if (actor.isSuperAdmin) return;
    const missing = [...keys].filter((k) => !actor.permissions.has(k));
    if (missing.length) throw new ForbiddenException(`You cannot grant access you do not hold yourself: ${missing.slice(0, 5).join(', ')}`);
  }

  /** Changing someone's email or password is taking over their account, so it needs at least the access they have. */
  private async assertCanManage(actor: AuthUser, id: string): Promise<UserAccess> {
    const access = await this.accessOf(id);
    if (actor.isSuperAdmin) return access;
    if (access.isSuperAdmin) throw new ForbiddenException('Only a super admin can change a super admin');
    if ([...this.effective(access)].some((k) => !actor.permissions.has(k))) throw new ForbiddenException('This user has access you do not hold, so you cannot change their account');
    return access;
  }

  private async accessOf(id: string): Promise<UserAccess> {
    const u = await this.prisma.user.findUnique({
      where: { id },
      select: { isSuperAdmin: true, permissions: { select: { effect: true, permission: { select: { key: true } } } }, roles: { select: { role: { select: { permissions: { select: { permission: { select: { key: true } } } } } } } } },
    });
    if (!u) throw new NotFoundException('User not found');
    return {
      isSuperAdmin: u.isSuperAdmin,
      roleKeys: u.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.key)),
      allowKeys: u.permissions.filter((p) => p.effect === 'ALLOW').map((p) => p.permission.key),
      denyKeys: u.permissions.filter((p) => p.effect === 'DENY').map((p) => p.permission.key),
    };
  }

  private effective(a: UserAccess) {
    return resolvePermissions({ isSuperAdmin: false, allPermissionKeys: [], rolePermissionKeys: a.roleKeys, userAllowKeys: a.allowKeys, userDenyKeys: a.denyKeys });
  }

  private gained(before: UserAccess, after: UserAccess) {
    const had = this.effective(before);
    return [...this.effective(after)].filter((k) => !had.has(k));
  }

  private async roleKeys(roleIds: string[]) {
    if (!roleIds.length) return [];
    const roles = await this.prisma.role.findMany({ where: { id: { in: roleIds } }, select: { permissions: { select: { permission: { select: { key: true } } } } } });
    return roles.flatMap((r) => r.permissions.map((p) => p.permission.key));
  }

  private async mustFind(id: string) {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw new NotFoundException('User not found');
    return u;
  }
}
