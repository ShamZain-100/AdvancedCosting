import { resolvePermissions } from './permissions';

const base = { isSuperAdmin: false, allPermissionKeys: ['a:view', 'a:edit', 'b:view'], rolePermissionKeys: [], userAllowKeys: [], userDenyKeys: [] };

describe('resolvePermissions', () => {
  it('unions role grants and user allows', () => {
    const r = resolvePermissions({ ...base, rolePermissionKeys: ['a:view'], userAllowKeys: ['b:view'] });
    expect([...r].sort()).toEqual(['a:view', 'b:view']);
  });
  it('user deny overrides role grant', () => {
    const r = resolvePermissions({ ...base, rolePermissionKeys: ['a:view', 'a:edit'], userDenyKeys: ['a:edit'] });
    expect([...r]).toEqual(['a:view']);
  });
  it('super admin gets all permissions even with denies', () => {
    const r = resolvePermissions({ ...base, isSuperAdmin: true, userDenyKeys: ['a:edit'] });
    expect(r.size).toBe(3);
  });
});
