import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { PermissionAction, PermissionModule } from '@costing/config';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  isSuperAdmin: boolean;
  sessionId: string;
  mustChangePassword?: boolean;
  permissions: Set<string>;
}

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Reachable while the user still has to replace a temporary password. Everything else answers 403 until they do. */
export const ALLOWED_BEFORE_PASSWORD_CHANGE = 'allowedBeforePasswordChange';
export const AllowedBeforePasswordChange = () => SetMetadata(ALLOWED_BEFORE_PASSWORD_CHANGE, true);

export const REQUIRED_PERMISSION = 'requiredPermission';
export const RequirePermission = (module: PermissionModule, action: PermissionAction) =>
  SetMetadata(REQUIRED_PERMISSION, `${module}:${action}`);

/** Any one of these permissions is enough (e.g. a designer's images:edit or a costing editor's costing:edit). */
export const ANY_PERMISSION = 'anyPermission';
export const RequireAnyPermission = (...keys: `${PermissionModule}:${PermissionAction}`[]) => SetMetadata(ANY_PERMISSION, keys);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser =>
  ctx.switchToHttp().getRequest().user);

export const ClientInfo = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest();
  return { ip: req.ip as string | undefined, userAgent: req.headers['user-agent'] as string | undefined };
});
