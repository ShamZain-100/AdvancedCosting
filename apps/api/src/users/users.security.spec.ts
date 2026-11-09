import { ForbiddenException } from '@nestjs/common';
import { RolesService } from '../roles/roles.service';
import { UsersService } from './users.service';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TARGET = uuid(1), ROLE = uuid(2), ME = uuid(3);
const key = (k: string) => ({ permission: { key: k } });
const held = (keys: string[]) => ({ role: { permissions: keys.map(key) } });

/** A target user holding `roles`, with `overrides`; `roleGrants` are the permissions of the role being assigned. */
function make(o: { roles?: string[]; overrides?: { effect: string; permission: { key: string } }[]; superAdmin?: boolean; roleGrants?: string[] } = {}) {
  const row = {
    id: TARGET, email: 't@x.com', name: 'T', isSuperAdmin: !!o.superAdmin, dealers: [],
    roles: [held(o.roles ?? [])], permissions: o.overrides ?? [],
  };
  const prisma: any = {
    user: { findUnique: jest.fn().mockResolvedValue(row), update: jest.fn().mockResolvedValue(row), create: jest.fn().mockResolvedValue(row) },
    role: { count: jest.fn().mockResolvedValue(1), findMany: jest.fn().mockResolvedValue([{ permissions: (o.roleGrants ?? []).map(key) }]) },
    permission: { findMany: jest.fn(async ({ where }: any) => where.key.in.map((k: string) => ({ id: k, key: k }))) },
    userRole: { deleteMany: jest.fn(), createMany: jest.fn() },
    userPermission: { deleteMany: jest.fn(), createMany: jest.fn() },
    userPriceListDealer: { deleteMany: jest.fn(), createMany: jest.fn() },
    priceListDealer: { count: jest.fn().mockResolvedValue(0) },
    session: { updateMany: jest.fn() },
    $transaction: jest.fn(async (ops: any[]) => ops),
  };
  const audit: any = { log: jest.fn() };
  return { svc: new UsersService(prisma, audit, { hashPassword: async () => 'hash' } as any), prisma, audit };
}
const manager = (perms: string[] = ['users:manage_settings', 'costing:view']): any => ({ id: ME, isSuperAdmin: false, permissions: new Set(perms) });
const owner: any = { id: ME, isSuperAdmin: true, permissions: new Set() };

describe('users: nobody can give away access they do not hold', () => {
  it('refuses a role with permissions the actor lacks, and writes nothing', async () => {
    const { svc, prisma } = make({ roleGrants: ['costing:approve'] });
    await expect(svc.setRoles(manager(), TARGET, [ROLE])).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.userRole.createMany).not.toHaveBeenCalled();
  });

  it('allows a role within the actor\'s own access', async () => {
    const { svc, prisma } = make({ roleGrants: ['costing:view'] });
    await svc.setRoles(manager(), TARGET, [ROLE]);
    expect(prisma.userRole.createMany).toHaveBeenCalled();
  });

  it('refuses an ALLOW override the actor lacks', async () => {
    const { svc } = make();
    await expect(svc.setOverrides(manager(), TARGET, [{ key: 'settings:manage_settings', effect: 'ALLOW' } as any])).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses removing a DENY when that would hand over access the actor lacks', async () => {
    const { svc } = make({ roles: ['costing:view'], overrides: [{ effect: 'DENY', permission: { key: 'costing:view' } }] });
    await expect(svc.setOverrides(manager(['users:manage_settings']), TARGET, [])).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses changing your own roles, overrides or group limit', async () => {
    const { svc } = make({ roleGrants: ['costing:view'] });
    const me = manager();
    await expect(svc.setRoles(me, ME, [ROLE])).rejects.toThrow(/your own access/);
    await expect(svc.setOverrides(me, ME, [])).rejects.toThrow(/your own access/);
    await expect(svc.setDealers(me, ME, [])).rejects.toThrow(/your own access/);
  });

  it('refuses creating a user with a role beyond the actor\'s access', async () => {
    const { svc, prisma } = make({ roleGrants: ['roles:edit'] });
    prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(svc.create(manager(), { email: 'n@x.com', name: 'N', password: 'Password-1', roleIds: [ROLE] } as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('a super admin can grant anything', async () => {
    const { svc, prisma } = make({ roleGrants: ['settings:manage_settings'] });
    await svc.setRoles(owner, TARGET, [ROLE]);
    expect(prisma.userRole.createMany).toHaveBeenCalled();
  });
});

describe('users: nobody can take over an account with more access', () => {
  it.each([
    ['change email', (s: UsersService, a: any) => s.update(a, TARGET, { email: 'me@x.com' })],
    ['reset password', (s: UsersService, a: any) => s.resetPassword(a, TARGET, 'Password-1')],
    ['deactivate', (s: UsersService, a: any) => s.setStatus(a, TARGET, false)],
    ['unlock', (s: UsersService, a: any) => s.unlock(a, TARGET)],
  ])('%s is refused on a user holding more access', async (_n, act) => {
    const { svc, prisma } = make({ roles: ['settings:manage_settings'] });
    await expect(act(svc, manager())).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('a super admin account cannot be changed by anyone else', async () => {
    const { svc } = make({ superAdmin: true });
    await expect(svc.update(manager(), TARGET, { email: 'me@x.com' })).rejects.toThrow(/super admin/);
  });

  it('unlock records the marker that resets the failure count', async () => {
    const { svc, audit } = make({ roles: ['costing:view'] });
    await svc.unlock(manager(), TARGET);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'login_unlocked', entity: 'User', entityId: TARGET }));
  });
});

describe('roles: nobody can add access they do not hold', () => {
  function roles(current: string[]) {
    const prisma: any = {
      role: { findUnique: jest.fn().mockResolvedValue({ id: ROLE }), create: jest.fn().mockResolvedValue({ id: ROLE }) },
      permission: { findMany: jest.fn(async ({ where }: any) => where.key.in.map((k: string) => ({ id: k, key: k }))) },
      rolePermission: { findMany: jest.fn().mockResolvedValue(current.map(key)), deleteMany: jest.fn(), createMany: jest.fn() },
      $transaction: jest.fn(async (ops: any[]) => ops),
    };
    return { svc: new RolesService(prisma, { log: jest.fn() } as any), prisma };
  }

  it('refuses adding a permission the actor lacks', async () => {
    const { svc, prisma } = roles([]);
    await expect(svc.setPermissions(manager(['roles:edit']), ROLE, ['settings:manage_settings'])).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.rolePermission.createMany).not.toHaveBeenCalled();
  });

  it('lets a role keep what it already has while the actor edits the rest', async () => {
    const { svc, prisma } = roles(['settings:manage_settings']);
    await svc.setPermissions(manager(['roles:edit', 'costing:view']), ROLE, ['settings:manage_settings', 'costing:view']);
    expect(prisma.rolePermission.createMany).toHaveBeenCalled();
  });

  it('refuses creating a role beyond the actor\'s access', async () => {
    const { svc, prisma } = roles([]);
    prisma.role.findUnique.mockResolvedValue(null);
    await expect(svc.create(manager(['roles:create']), { name: 'X', permissionKeys: ['costing:approve'] } as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.role.create).not.toHaveBeenCalled();
  });
});
