import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { RequirePermission } from '../common/decorators';
import { Orientation } from './pdf';
import { PrintService } from './print.service';

const orient = (v?: string): Orientation => {
  if (v === undefined || v === 'portrait') return 'portrait';
  if (v === 'landscape') return 'landscape';
  throw new BadRequestException('orientation must be portrait or landscape');
};

@ApiTags('print')
@ApiBearerAuth()
@Controller('print')
export class PrintController {
  constructor(private readonly svc: PrintService) {}

  private send(res: Response, f: { buffer: Buffer; filename: string }) {
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${f.filename.replace(/[^\w.-]/g, '_')}"`, 'X-Content-Type-Options': 'nosniff' });
    return new StreamableFile(f.buffer);
  }

  @Get('costings/:id') @RequirePermission('costing', 'print')
  costing(@Param('id', ParseUUIDPipe) id: string) { return this.svc.costingPreview(id); }

  @Get('costings/:id/pdf') @RequirePermission('costing', 'print')
  async costingPdf(@Param('id', ParseUUIDPipe) id: string, @Query('mode') mode = 'detailed', @Query('orientation') o: string | undefined, @Res({ passthrough: true }) res: Response) {
    return this.send(res, await this.svc.costingPdf(id, mode, orient(o)));
  }

  @Get('quotations/:id/pdf') @RequirePermission('quotations', 'print')
  async quotationPdf(@Param('id', ParseUUIDPipe) id: string, @Query('orientation') o: string | undefined, @Res({ passthrough: true }) res: Response) {
    return this.send(res, await this.svc.quotationPdf(id, orient(o)));
  }

  @Get('price-lists/:id/pdf') @RequirePermission('price_lists', 'print')
  async priceListPdf(@Param('id', ParseUUIDPipe) id: string, @Query('orientation') o: string | undefined, @Res({ passthrough: true }) res: Response) {
    return this.send(res, await this.svc.priceListPdf(id, orient(o)));
  }
}
