import { Body, Controller, Delete, Get, Post, Put, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthUser, CurrentUser, RequirePermission, AllowedBeforePasswordChange } from '../common/decorators';
import { MAX_UPLOAD_BYTES } from '../images/image-processor';
import { CompanyService } from './company.service';

@ApiTags('company')
@ApiBearerAuth()
@Controller('company-settings')
export class CompanyController {
  constructor(private readonly svc: CompanyService) {}

  // every signed-in user can read the company identity (it is printed on every document)
  @AllowedBeforePasswordChange() @Get() get() { return this.svc.get(); }

  @Put() @RequirePermission('settings', 'manage_settings')
  update(@CurrentUser() u: AuthUser, @Body() body: unknown) { return this.svc.update(u, body); }

  @Post('logo') @RequirePermission('settings', 'manage_settings') @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  logo(@CurrentUser() u: AuthUser, @UploadedFile() file?: Express.Multer.File) { return this.svc.setLogo(u, file); }

  @Delete('logo') @RequirePermission('settings', 'manage_settings')
  removeLogo(@CurrentUser() u: AuthUser) { return this.svc.removeLogo(u); }
}
