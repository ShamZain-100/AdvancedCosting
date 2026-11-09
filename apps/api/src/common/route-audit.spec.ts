import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { PERMISSION_ACTIONS, PERMISSION_MODULES } from '@costing/config';
import { AppModule } from '../app.module';
import { ALLOWED_BEFORE_PASSWORD_CHANGE, ANY_PERMISSION, IS_PUBLIC, REQUIRED_PERMISSION } from './decorators';
import { ALL, ROLES } from '../seed/seed';

/**
 * Walks every controller route in the real application module and checks how it is protected.
 * A new endpoint that forgets @RequirePermission fails here until someone decides, in this file, that "any signed-in user" is intended.
 */
/** `permission` is one key, or for any-of routes the keys joined with ' | ' (each one alone opens the route). */
interface Route { method: string; path: string; permission?: string; anyOf?: string[]; isPublic: boolean; beforePasswordChange: boolean }

function modulesOf(root: any, seen = new Set<any>()): any[] {
  if (!root || seen.has(root)) return [];
  seen.add(root);
  const imports: any[] = Reflect.getMetadata('imports', root) ?? [];
  return [root, ...imports.flatMap((i) => modulesOf(i?.module ?? i, seen))];
}

function routes(): Route[] {
  const out: Route[] = [];
  const controllers = new Set<any>(modulesOf(AppModule).flatMap((m) => Reflect.getMetadata('controllers', m) ?? []));
  for (const c of controllers) {
    const prefix = String(Reflect.getMetadata('path', c) ?? '');
    for (const name of Object.getOwnPropertyNames(c.prototype)) {
      const handler = c.prototype[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      const method = Reflect.getMetadata('method', handler);
      if (method === undefined) continue;
      const get = (k: string) => Reflect.getMetadata(k, handler) ?? Reflect.getMetadata(k, c);
      out.push({
        method: RequestMethod[method], path: `/${prefix}/${Reflect.getMetadata('path', handler)}`.replace(/\/+/g, '/').replace(/\/$/, ''),
        permission: get(REQUIRED_PERMISSION) ?? (get(ANY_PERMISSION) as string[] | undefined)?.join(' | '), anyOf: get(ANY_PERMISSION), isPublic: get(IS_PUBLIC) === true, beforePasswordChange: get(ALLOWED_BEFORE_PASSWORD_CHANGE) === true,
      });
    }
  }
  return out;
}

/** Routes that only need a valid login, each with the reason it is safe. Everything else must name a permission. */
const SIGNED_IN_ONLY: Record<string, string> = {
  'GET /auth/me': 'own profile',
  'POST /auth/logout': 'ends own session',
  'POST /auth/change-password': 'own password, current password required',
  'GET /settings/defaults': 'non-sensitive defaults needed by every form',
  'GET /company-settings': 'letterhead data printed on every document',
  'PATCH /auth/me': 'own profile',
  'GET /auth/sessions': 'own sessions only',
  'DELETE /auth/sessions/:id': 'own sessions only',
  'GET /notifications': 'own notifications only',
  'GET /notifications/push-key': 'public VAPID key, needed to turn on push',
  'POST /notifications/read-all': 'own notifications only',
  'POST /notifications/:id/read': 'own notifications only (by user id)',
  'POST /notifications/subscriptions': 'registers the caller\'s own device',
  'DELETE /notifications/subscriptions': 'removes the caller\'s own device',
};

/** Routes without a decorator because the permission depends on the record or kind; the service checks it (and has its own tests). */
const SERVICE_CHECKED: Record<string, string> = {
  'POST /recalculation/flags/:id/resolve': 'quotations:edit or price_lists:edit depending on the flag',
  'GET /data/export/kinds': 'lists only the kinds the user may export',
  'GET /data/export/costing/:id': 'costing:export',
  'GET /data/export/:kind': '<module>:export for the requested kind',
};

/** Public by design: sign-in and password reset, the health probe, signed file links (HMAC) and the customer quotation link (secret token). */
const PUBLIC_ROUTES = [
  'POST /auth/login', 'POST /auth/refresh', 'POST /auth/forgot-password', 'POST /auth/reset-password', 'GET /health',
  'GET /files/:id', 'GET /public/quotations/:token',
];

const all = routes();
const label = (r: Route) => `${r.method} ${r.path}`;

describe('route protection audit', () => {
  it('a user with a temporary password can reach only what they need to change it', () => {
    expect(all.filter((r) => r.beforePasswordChange).map(label).sort()).toEqual([
      'DELETE /auth/sessions/:id', 'GET /auth/me', 'GET /auth/sessions', 'GET /company-settings', 'GET /settings/defaults', 'PATCH /auth/me', 'POST /auth/change-password', 'POST /auth/logout',
    ]);
  });

  it('finds the application routes', () => {
    expect(all.length).toBeGreaterThan(150);
  });

  it('only the expected routes are public', () => {
    const open = all.filter((r) => r.isPublic).map(label).sort();
    expect(open).toEqual([...PUBLIC_ROUTES].sort());
  });

  it('every non-public route names a permission or is a known signed-in-only route', () => {
    const unguarded = all.filter((r) => !r.isPublic && !r.permission).map(label).filter((l) => !(l in SIGNED_IN_ONLY) && !(l in SERVICE_CHECKED));
    expect(unguarded).toEqual([]);
  });

  it('every permission used by a route exists in the permission catalogue', () => {
    const bad = all.filter((r) => r.permission).filter((r) => (r.anyOf ?? [r.permission!]).some((p) => {
      const [m, a] = p.split(':');
      return !(PERMISSION_MODULES as readonly string[]).includes(m) || !(PERMISSION_ACTIONS as readonly string[]).includes(a);
    })).map(label);
    expect(bad).toEqual([]);
  });

  it('no data-changing route is readable with only a view permission', () => {
    const weak = all.filter((r) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method) && (r.anyOf ?? [r.permission ?? '']).some((p) => p.endsWith(':view')))
      // read-style POSTs: previews and dry runs compute but do not save
      .filter((r) => !/preview|dry|calculate|check|search|validate/i.test(r.path))
      .map((r) => `${label(r)} -> ${r.permission}`);
    expect(weak).toEqual([]);
  });

  it('signed-in-only routes are all reads or own-account actions', () => {
    const writes = all.filter((r) => !r.isPublic && !r.permission && r.method !== 'GET').map(label).filter((l) => !(l in SERVICE_CHECKED));
    expect(writes.sort()).toEqual(['DELETE /auth/sessions/:id', 'DELETE /notifications/subscriptions', 'PATCH /auth/me', 'POST /auth/change-password', 'POST /auth/logout', 'POST /notifications/:id/read', 'POST /notifications/read-all', 'POST /notifications/subscriptions'].sort());
  });

  it('user, role and settings administration is never open to ordinary permissions', () => {
    const admin = all.filter((r) => /^\/(users|roles|settings)(\/|$)/.test(r.path) && r.method !== 'GET' && !r.path.includes('preview'));
    expect(admin.length).toBeGreaterThan(0);
    for (const r of admin) expect(r.permission).toMatch(/^(users|roles|settings):/);
  });
});

/** Permissions each starter role is granted, expanded the way the seed does it. */
const grantsOf = (role: string) => new Set(Object.entries(ROLES[role].grants).flatMap(([m, a]) => (a === ALL ? [...PERMISSION_ACTIONS] : a).map((x) => `${m}:${x}`)));
const opens = (role: string, r: Route) => (r.anyOf ?? [r.permission!]).some((p) => grantsOf(role).has(p));
const allowed = (role: string) => all.filter((r) => r.permission && opens(role, r)).map(label);
const denied = (role: string) => all.filter((r) => r.permission && !opens(role, r)).map(label);

describe('starter roles against the real routes', () => {
  it('Admin can reach every protected route', () => {
    expect(denied('Admin')).toEqual([]);
  });

  it('Accountant has no access to users, roles, settings, audit logs or data import', () => {
    const open = allowed('Accountant').filter((l) => /\s\/(users|roles|audit-logs|company-settings|data\/import)/.test(l) && !l.startsWith('GET'));
    expect(open).toEqual([]);
    expect(allowed('Accountant').filter((l) => /^(PUT|POST) \/settings/.test(l) && !l.includes('preview'))).toEqual([]);
  });

  it('Staff can read and create costings but never approve, delete, change rates or administer', () => {
    const ok = allowed('Staff');
    expect(ok).toContain('POST /costings');
    expect(ok.filter((l) => !l.startsWith('GET') && !/costings/.test(l) && !/print|preview/i.test(l))).toEqual([]);
    const staff = grantsOf('Staff');
    for (const forbidden of ['costing:approve', 'costing:delete', 'purchase_rates:manage_rates', 'users:view', 'roles:view', 'settings:manage_settings', 'data_management:import'])
      expect(staff.has(forbidden)).toBe(false);
  });

  it('Staff can finish the costing they started, and Accountant can record a purchase', () => {
    expect(allowed('Staff')).toEqual(expect.arrayContaining(['POST /costings', 'PUT /costings/:id', 'POST /costings/:id/submit']));
    expect(allowed('Accountant')).toContain('POST /purchase-rates');
  });

  it('Staff is stopped at every data-changing route outside costing creation', () => {
    const blocked = denied('Staff').filter((l) => !l.startsWith('GET'));
    expect(blocked).toEqual(expect.arrayContaining(['DELETE /costings/:id', 'POST /users', 'PUT /settings', 'POST /purchase-rates', 'POST /price-list-dealers', 'PUT /users/:id/dealers']));
  });

  it('a Price List Dealer reaches only the dealer price list', () => {
    expect(allowed('Price List Dealer').sort()).toEqual(['GET /price-list', 'GET /price-list/excel']);
  });

  it('the cost report needs costing access and publishing needs price list approval', () => {
    const at = (l: string) => all.find((r) => label(r) === l)?.permission;
    expect(at('GET /cost-report')).toBe('costing:view');
    expect(at('PATCH /costings/:id/publish')).toBe('price_lists:approve');
    expect(allowed('Staff')).not.toContain('PATCH /costings/:id/publish');
  });

  it('a Designer reaches product photos and nothing that shows a cost', () => {
    const ok = allowed('Designer');
    expect(ok).toEqual(expect.arrayContaining(['GET /product-images', 'POST /costings/:ownerId/images', 'GET /costings/:ownerId/images']));
    expect(ok.filter((l) => /costing|cost-report|price-list|reports|quotations/.test(l) && !/images/.test(l))).toEqual([]);
  });
});
