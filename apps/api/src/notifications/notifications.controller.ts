import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, ClientInfo, CurrentUser } from '../common/decorators';
import { NotificationsService } from './notifications.service';

/** A user's own notifications and push devices: signed-in only, every query is limited to the caller. */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) { return this.svc.list(u, q); }

  @Get('push-key')
  pushKey() { return this.svc.pushKey(); }

  @Post('read-all') @HttpCode(200)
  readAll(@CurrentUser() u: AuthUser) { return this.svc.markAllRead(u); }

  @Post('subscriptions') @HttpCode(200)
  subscribe(@CurrentUser() u: AuthUser, @Body() body: any, @ClientInfo() c: { userAgent?: string }) { return this.svc.subscribe(u, body, c.userAgent); }

  @Delete('subscriptions')
  unsubscribe(@CurrentUser() u: AuthUser, @Body() body: { endpoint?: string }) { return this.svc.unsubscribe(u, body?.endpoint); }

  @Post(':id/read') @HttpCode(200)
  read(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.markRead(u, id); }
}
