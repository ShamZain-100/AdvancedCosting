export interface PermissionInputs {
  isSuperAdmin: boolean;
  allPermissionKeys: string[];
  rolePermissionKeys: string[];
  userAllowKeys: string[];
  userDenyKeys: string[];
}

/** Effective permissions = (role grants + user ALLOW) minus user DENY. Super admins get everything. */
export function resolvePermissions(i: PermissionInputs): Set<string> {
  if (i.isSuperAdmin) return new Set(i.allPermissionKeys);
  const granted = new Set([...i.rolePermissionKeys, ...i.userAllowKeys]);
  for (const k of i.userDenyKeys) granted.delete(k);
  return granted;
}
