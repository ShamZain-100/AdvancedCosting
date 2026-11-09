import { Controller, Get, Param, ParseUUIDPipe, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { ExportService } from './export.service';
import { ImportService } from './import.service';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const upload = FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

@ApiTags('data')
@ApiBearerAuth()
@Controller('data')
export class DataController {
  constructor(private readonly imports: ImportService, private readonly exports: ExportService) {}

  @Get('import/kinds') @RequirePermission('data_management', 'import')
  importKinds(@CurrentUser() u: AuthUser) { return this.imports.kinds(u); }

  @Get('import/history') @RequirePermission('data_management', 'import')
  history(@Query('kind') kind?: string) { return this.imports.history(kind); }

  @Get('import/:kind/template') @RequirePermission('data_management', 'import')
  async template(@CurrentUser() u: AuthUser, @Param('kind') kind: string, @Res({ passthrough: true }) res: Response) {
    res.set({ 'Content-Type': XLSX, 'Content-Disposition': `attachment; filename="${kind.replace(/[^a-z-]/g, '')}-template.xlsx"` });
    return new StreamableFile(await this.imports.template(u, kind));
  }

  @Post('import/:kind/preview') @RequirePermission('data_management', 'import') @Throttle({ default: { limit: 20, ttl: 60_000 } }) @UseInterceptors(upload)
  preview(@CurrentUser() u: AuthUser, @Param('kind') kind: string, @UploadedFile() file?: Express.Multer.File) { return this.imports.preview(u, kind, file); }

  @Post('import/:kind/confirm') @RequirePermission('data_management', 'import') @Throttle({ default: { limit: 10, ttl: 60_000 } }) @UseInterceptors(upload)
  confirm(@CurrentUser() u: AuthUser, @Param('kind') kind: string, @Query('skipInvalid') skip?: string, @UploadedFile() file?: Express.Multer.File) { return this.imports.confirm(u, kind, file, skip === 'true'); }

  @Get('export/kinds')
  exportKinds(@CurrentUser() u: AuthUser) { return this.exports.kinds(u); }

  @Get('export/costing/:id')
  async costing(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const { buffer, filename } = await this.exports.costingDetail(u, id);
    res.set({ 'Content-Type': XLSX, 'Content-Disposition': `attachment; filename="${filename}"` });
    return new StreamableFile(buffer);
  }

  @Get('export/:kind')
  async export(@CurrentUser() u: AuthUser, @Param('kind') kind: string, @Query() q: Record<string, string>, @Res({ passthrough: true }) res: Response) {
    const { buffer, filename } = await this.exports.export(u, kind, q);
    res.set({ 'Content-Type': XLSX, 'Content-Disposition': `attachment; filename="${filename}"` });
    return new StreamableFile(buffer);
  }
}
