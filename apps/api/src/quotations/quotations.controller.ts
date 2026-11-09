import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthUser, CurrentUser, Public, RequirePermission } from '../common/decorators';
import { QuotationAction, QuotationsService } from './quotations.service';

const ACTIONS = ['submit', 'withdraw', 'approve', 'reject', 'send', 'accept', 'decline', 'convert', 'revise'];

@ApiTags('quotations')
@ApiBearerAuth()
@Controller('quotations')
export class QuotationsController {
  constructor(private readonly svc: QuotationsService) {}

  @Get() @RequirePermission('quotations', 'view')
  list(@Query() q: Record<string, string>) { return this.svc.list(q); }

  @Post('preview') @RequirePermission('quotations', 'view')
  preview(@Body() body: unknown) { return this.svc.preview(body); }

  @Get(':id') @RequirePermission('quotations', 'view')
  get(@Param('id', ParseUUIDPipe) id: string) { return this.svc.get(id); }

  @Get(':id/export') @RequirePermission('quotations', 'export')
  async export(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="quotation.xlsx"' });
    return new StreamableFile(await this.svc.exportExcel(id));
  }

  @Post() @RequirePermission('quotations', 'create')
  create(@CurrentUser() u: AuthUser, @Body() body: unknown) { return this.svc.create(u, body); }

  @Put(':id') @RequirePermission('quotations', 'edit')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.svc.update(u, id, body); }

  @Post(':id/duplicate') @RequirePermission('quotations', 'create')
  duplicate(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.duplicate(u, id); }

  @Post(':id/reprice') @RequirePermission('quotations', 'edit')
  reprice(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.reprice(u, id); }

  @Post(':id/share') @RequirePermission('quotations', 'edit')
  share(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.svc.createShare(u, id, body); }

  @Get(':id/shares') @RequirePermission('quotations', 'view')
  shares(@Param('id', ParseUUIDPipe) id: string) { return this.svc.listShares(id); }

  @Delete(':id/shares/:shareId') @RequirePermission('quotations', 'edit')
  revoke(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('shareId', ParseUUIDPipe) shareId: string) { return this.svc.revokeShare(u, id, shareId); }

  @Post(':id/:action') @RequirePermission('quotations', 'edit')
  transition(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('action') action: string, @Body() body: unknown) {
    return this.svc.transition(u, id, (ACTIONS.includes(action) ? action : 'invalid') as QuotationAction, body);
  }

  @Delete(':id') @RequirePermission('quotations', 'delete')
  remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.remove(u, id); }
}

/** Unauthenticated, read-only view for customers who received a share link. */
@ApiTags('public')
@Controller('public')
export class PublicQuotationsController {
  constructor(private readonly svc: QuotationsService) {}

  @Public() @Throttle({ default: { limit: 30, ttl: 60_000 } }) @Get('quotations/:token')
  view(@Param('token') token: string) { return this.svc.publicView(token.slice(0, 200)); }
}
