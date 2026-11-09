import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { RecalcService } from './recalc.service';

@ApiTags('recalculation')
@ApiBearerAuth()
@Controller('recalculation')
export class RecalcController {
  constructor(private readonly svc: RecalcService) {}

  @Get('policy') @RequirePermission('purchase_rates', 'view')
  policy() { return this.svc.getPolicy(); }

  @Put('policy') @RequirePermission('settings', 'manage_settings')
  setPolicy(@CurrentUser() u: AuthUser, @Body() body: unknown) { return this.svc.setPolicy(u, body); }

  @Get('batches') @RequirePermission('purchase_rates', 'view')
  list(@Query() q: Record<string, string>) { return this.svc.list(q); }

  @Get('batches/:id') @RequirePermission('purchase_rates', 'view')
  get(@Param('id', ParseUUIDPipe) id: string) { return this.svc.get(id); }

  /** Before / after figures per costing; reads costing totals, so it needs costing view access as well. */
  @Get('batches/:id/preview') @RequirePermission('costing', 'view')
  preview(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.preview(u, id); }

  @Post('batches/:id/apply') @RequirePermission('purchase_rates', 'manage_rates')
  apply(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.apply(u, id); }

  @Post('batches/:id/dismiss') @RequirePermission('purchase_rates', 'manage_rates')
  dismiss(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.svc.dismiss(u, id, body); }

  @Get('flags') @RequirePermission('purchase_rates', 'view')
  flags(@CurrentUser() u: AuthUser) { return this.svc.openFlags(u); }

  @Post('flags/:id/resolve')
  resolve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.resolveFlag(u, id); }
}
