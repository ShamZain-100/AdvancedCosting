import { Controller, Get, Param, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly svc: ReportsService) {}

  @Get() @RequirePermission('reports', 'view')
  list(@CurrentUser() u: AuthUser) { return this.svc.list(u); }

  @Get(':id') @RequirePermission('reports', 'view')
  run(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query() q: Record<string, string>) { return this.svc.run(u, id, q); }

  @Get(':id/excel') @RequirePermission('reports', 'export')
  async excel(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query() q: Record<string, string>, @Res({ passthrough: true }) res: Response) {
    const { buffer, filename } = await this.svc.excel(u, id, q);
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${filename}"` });
    return new StreamableFile(buffer);
  }

  @Get(':id/pdf') @RequirePermission('reports', 'print')
  async pdf(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query() q: Record<string, string>, @Res({ passthrough: true }) res: Response) {
    const { buffer, filename } = await this.svc.pdf(u, id, q);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"`, 'X-Content-Type-Options': 'nosniff' });
    return new StreamableFile(buffer);
  }
}
