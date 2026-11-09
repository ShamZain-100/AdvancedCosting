import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { CostingSettingsService } from './costing-settings.service';
import { CostingsService } from './costings.service';

@ApiTags('costings')
@ApiBearerAuth()
@Controller()
export class CostingsController {
  constructor(private readonly svc: CostingsService, private readonly settings: CostingSettingsService) {}

  @Get('costings') @RequirePermission('costing', 'view')
  list(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) { return this.svc.listFor(u, q); }

  @Get('costings/from-template/:templateId') @RequirePermission('costing', 'create')
  fromTemplate(@Param('templateId', ParseUUIDPipe) id: string) { return this.svc.fromTemplate(id); }

  @Post('costings/preview') @RequirePermission('costing', 'view')
  preview(@CurrentUser() u: AuthUser, @Body() body: unknown, @Query('costingId') costingId?: string) { return this.svc.preview(u, body, costingId); }

  @Get('costings/:id') @RequirePermission('costing', 'view')
  get(@Param('id', ParseUUIDPipe) id: string) { return this.svc.get(id); }

  @Get('costings/:id/revisions') @RequirePermission('costing', 'view')
  revisions(@Param('id', ParseUUIDPipe) id: string) { return this.svc.revisions(id); }

  @Post('costings') @RequirePermission('costing', 'create')
  create(@CurrentUser() u: AuthUser, @Body() body: unknown) { return this.svc.create(u, body); }

  @Put('costings/:id') @RequirePermission('costing', 'edit')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.svc.update(u, id, body); }

  @Post('costings/:id/refresh-rates') @RequirePermission('costing', 'edit')
  refresh(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.refreshRates(u, id); }

  @Post('costings/:id/submit') @RequirePermission('costing', 'edit')
  submit(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.svc.setStatus(u, id, 'submit', body); }

  @Post('costings/:id/approve') @RequirePermission('costing', 'approve')
  approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.svc.setStatus(u, id, 'approve', body); }

  @Post('costings/:id/reject') @RequirePermission('costing', 'approve')
  reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.svc.setStatus(u, id, 'reject', body); }

  @Post('costings/:id/reopen') @RequirePermission('costing', 'approve')
  reopen(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.svc.setStatus(u, id, 'reopen', body); }

  @Post('costings/:id/save-as-template') @RequirePermission('templates', 'create')
  saveAsTemplate(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.svc.saveAsTemplate(u, id, body); }

  @Delete('costings/:id') @RequirePermission('costing', 'delete')
  remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.remove(u, id); }

  @Get('costing-settings') @RequirePermission('costing', 'view')
  rules() { return this.settings.getRules(); }

  @Put('costing-settings') @RequirePermission('settings', 'manage_settings')
  setRules(@CurrentUser() u: AuthUser, @Body() body: unknown) { return this.settings.setRules(u, body); }
}
