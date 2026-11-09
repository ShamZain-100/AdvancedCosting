import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, RequirePermission, AllowedBeforePasswordChange } from '../common/decorators';
import { NumberingService } from './numbering.service';
import { SettingsService } from './settings.service';

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(private readonly svc: SettingsService, private readonly numbering: NumberingService) {}

  /** Defaults, print and approval options for pre-filling forms: any signed-in user. */
  @AllowedBeforePasswordChange() @Get('defaults')
  defaults() { return this.svc.defaults(); }

  @Get() @RequirePermission('settings', 'view')
  get() { return this.svc.get(); }

  @Put() @RequirePermission('settings', 'manage_settings')
  update(@CurrentUser() u: AuthUser, @Body() body: unknown) { return this.svc.update(u, body); }

  @Post('numbering/preview') @RequirePermission('settings', 'view')
  preview(@Body() body: unknown) { return this.numbering.preview(body); }
}
