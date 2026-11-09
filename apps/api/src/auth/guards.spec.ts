import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard, PermissionsGuard } from './guards';
import { ALLOWED_BEFORE_PASSWORD_CHANGE, IS_PUBLIC, REQUIRED_PERMISSION } from '../common/decorators';

const ctx = (req: any) => ({ getHandler: () => 0, getClass: () => 1, switchToHttp: () => ({ getRequest: () => req }) }) as any;
const reflectorWith = (meta: Record<string, unknown>) => ({ getAllAndOverride: (k: string) => meta[k] }) as unknown as Reflector;

describe('JwtAuthGuard', () => {
  it('lets public routes through without a token', async () => {
    const g = new JwtAuthGuard(reflectorWith({ [IS_PUBLIC]: true }), {} as any);
    await expect(g.canActivate(ctx({ headers: {} }))).resolves.toBe(true);
  });
  it('rejects a missing bearer token', async () => {
    const g = new JwtAuthGuard(reflectorWith({}), {} as any);
    await expect(g.canActivate(ctx({ headers: {} }))).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('attaches the authenticated user', async () => {
    const user = { id: 'u1' };
    const g = new JwtAuthGuard(reflectorWith({}), { authenticate: jest.fn().mockResolvedValue(user) } as any);
    const req: any = { headers: { authorization: 'Bearer abc' } };
    await g.canActivate(ctx(req));
    expect(req.user).toBe(user);
  });
});

describe('JwtAuthGuard with a temporary password', () => {
  const auth = { authenticate: jest.fn().mockResolvedValue({ id: 'u1', mustChangePassword: true }) } as any;
  const req = () => ({ headers: { authorization: 'Bearer abc' } });
  it('refuses ordinary routes until the password is changed', async () => {
    await expect(new JwtAuthGuard(reflectorWith({}), auth).canActivate(ctx(req()))).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('allows the routes needed to change it', async () => {
    await expect(new JwtAuthGuard(reflectorWith({ [ALLOWED_BEFORE_PASSWORD_CHANGE]: true }), auth).canActivate(ctx(req()))).resolves.toBe(true);
  });
});

describe('PermissionsGuard', () => {
  const user = (keys: string[]) => ({ user: { permissions: new Set(keys) } });
  it('allows routes with no required permission', () => {
    expect(new PermissionsGuard(reflectorWith({})).canActivate(ctx(user([])))).toBe(true);
  });
  it('allows when the user holds the permission', () => {
    const g = new PermissionsGuard(reflectorWith({ [REQUIRED_PERMISSION]: 'users:view' }));
    expect(g.canActivate(ctx(user(['users:view'])))).toBe(true);
  });
  it('forbids when the permission is missing (backend enforcement)', () => {
    const g = new PermissionsGuard(reflectorWith({ [REQUIRED_PERMISSION]: 'users:delete' }));
    expect(() => g.canActivate(ctx(user(['users:view'])))).toThrow(ForbiddenException);
  });
});
