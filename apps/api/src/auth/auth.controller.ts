import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { ChangePasswordDto, ForgotPasswordDto, LoginDto, ResetPasswordDto, UpdateProfileDto } from './auth.dto';
import { AuthUser, ClientInfo, CurrentUser, Public, AllowedBeforePasswordChange } from '../common/decorators';

const COOKIE = 'refresh_token';
const readCookie = (req: Request, name: string) =>
  req.headers.cookie?.split(';').map((c) => c.trim().split('=')).find(([k]) => k === name)?.[1];

@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly prisma: PrismaService) {}

  private setRefreshCookie(res: Response, token: string) {
    res.cookie(COOKIE, token, {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production',
      path: '/api/auth', maxAge: 7 * 24 * 3600 * 1000,
    });
  }

  @Public() @Throttle({ default: { limit: 10, ttl: 60_000 } }) @Post('login') @HttpCode(200)
  async login(@Body() dto: LoginDto, @ClientInfo() meta: { ip?: string; userAgent?: string }, @Res({ passthrough: true }) res: Response) {
    const { accessToken, refreshToken, mustChangePassword } = await this.auth.login(dto.email, dto.password, meta);
    this.setRefreshCookie(res, refreshToken);
    return { accessToken, mustChangePassword };
  }

  @Public() @Post('refresh') @HttpCode(200)
  async refresh(@Req() req: Request, @ClientInfo() meta: { ip?: string; userAgent?: string }, @Res({ passthrough: true }) res: Response) {
    const { accessToken, refreshToken } = await this.auth.refresh(readCookie(req, COOKIE) ?? '', meta);
    this.setRefreshCookie(res, refreshToken);
    return { accessToken };
  }

  @AllowedBeforePasswordChange() @Post('logout') @HttpCode(200)
  async logout(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(user.sessionId);
    res.clearCookie(COOKIE, { path: '/api/auth' });
    return { message: 'Logged out' };
  }

  @Public() @Throttle({ default: { limit: 5, ttl: 60_000 } }) @Post('forgot-password') @HttpCode(200)
  forgot(@Body() dto: ForgotPasswordDto) { return this.auth.forgotPassword(dto.email); }

  @Public() @Throttle({ default: { limit: 5, ttl: 60_000 } }) @Post('reset-password') @HttpCode(200)
  reset(@Body() dto: ResetPasswordDto) { return this.auth.resetPassword(dto.token, dto.newPassword); }

  @AllowedBeforePasswordChange() @Post('change-password') @HttpCode(200)
  change(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user, dto.currentPassword, dto.newPassword);
  }

  @AllowedBeforePasswordChange() @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const rec = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { id: true, email: true, name: true, mobile: true, isSuperAdmin: true, mustChangePassword: true, lastLoginAt: true, roles: { select: { role: { select: { id: true, name: true } } } } },
    });
    return { ...rec, roles: rec.roles.map((r) => r.role), permissions: [...user.permissions].sort() };
  }

  @AllowedBeforePasswordChange() @Patch('me')
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.prisma.user.update({ where: { id: user.id }, data: dto, select: { id: true, name: true, mobile: true } });
  }

  @AllowedBeforePasswordChange() @Get('sessions')
  async sessions(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.session.findMany({
      where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastUsedAt: 'desc' },
      select: { id: true, ip: true, userAgent: true, createdAt: true, lastUsedAt: true },
    });
    return rows.map((s) => ({ ...s, current: s.id === user.sessionId }));
  }

  @AllowedBeforePasswordChange() @Delete('sessions/:id')
  async revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.prisma.session.updateMany({ where: { id, userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    return { message: 'Session revoked' };
  }
}
