import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { DealerPricesService } from './dealer-prices.service';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@ApiTags('price list')
@ApiBearerAuth()
@Controller()
export class DealerPricesController {
  constructor(private readonly svc: DealerPricesService) {}

  @Get('price-list') @RequirePermission('dealer_price_list', 'view')
  priceList(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) { return this.strip(this.svc.priceList(u, q)); }

  @Get('price-list/excel') @RequirePermission('dealer_price_list', 'export')
  async priceListExcel(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>, @Res({ passthrough: true }) res: Response) {
    return this.file(res, await this.svc.excel(u, 'price-list', q));
  }

  @Get('cost-report') @RequirePermission('costing', 'view')
  costReport(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) { return this.strip(this.svc.costReport(u, q)); }

  @Get('cost-report/excel') @RequirePermission('costing', 'export')
  async costReportExcel(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>, @Res({ passthrough: true }) res: Response) {
    return this.file(res, await this.svc.excel(u, 'cost-report', q));
  }

  @Patch('costings/:id/publish') @RequirePermission('price_lists', 'approve')
  publish(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.svc.setPublished(u, id, body); }

  /** the screen gets one page; the full filtered set is only for exports */
  private async strip<T extends { all: unknown }>(p: Promise<T>) { const { all: _all, ...rest } = await p; return rest; }

  private file(res: Response, f: { buffer: Buffer; filename: string }) {
    res.set({ 'Content-Type': XLSX, 'Content-Disposition': `attachment; filename="${f.filename}"` });
    return new StreamableFile(f.buffer);
  }
}
