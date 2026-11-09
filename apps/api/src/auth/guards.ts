import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from './auth.service';
import { ALLOWED_BEFORE_PASSWORD_CHANGE, ANY_PERMISSION, AuthUser, IS_PUBLIC, REQUIRED_PERMISSION } from '../common/decorators';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException();
    req.user = await this.auth.authenticate(header.slice(7));
    if (req.user.mustChangePassword && !this.reflector.getAllAndOverride<boolean>(ALLOWED_BEFORE_PASSWORD_CHANGE, [ctx.getHandler(), ctx.getClass()])) {
      throw new ForbiddenException('Change your temporary password before continuing');
    }
    return true;
  }
}

/** Runs after JwtAuthGuard. Endpoints without @RequirePermission only need a valid login. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext) {
    const required = this.reflector.getAllAndOverride<string>(REQUIRED_PERMISSION, [ctx.getHandler(), ctx.getClass()]);
    const any = this.reflector.getAllAndOverride<string[]>(ANY_PERMISSION, [ctx.getHandler(), ctx.getClass()]);
    const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
    if (any?.length) {
      if (!any.some((k) => user?.permissions.has(k))) throw new ForbiddenException(`Missing permission: one of ${any.join(', ')}`);
      if (!required) return true;
    }
    if (!required) return true;
    if (!user?.permissions.has(required)) throw new ForbiddenException(`Missing permission: ${required}`);
    return true;
  }
}
