import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { PurchaseRatesService } from './purchase-rates.service';
import { RatesExcelService } from './rates-excel.service';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const upload = FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

@ApiTags('purchase-rates')
@ApiBearerAuth()
@Controller('purchase-rates')
export class PurchaseRatesController {
  constructor(private readonly svc: PurchaseRatesService, private readonly excel: RatesExcelService) {}

  @Get() @RequirePermission('purchase_rates', 'view')
  list(@Query() q: Record<string, string>) { return this.svc.listEntries(q); }

  @Get('summary') @RequirePermission('purchase_rates', 'view')
  summary(@Query() q: Record<string, string>) { return this.svc.summary(q); }

  @Get('history') @RequirePermission('purchase_rates', 'view')
  history(@Query() q: Record<string, string>) { return this.svc.history(q); }

  @Get('item-units') @RequirePermission('purchase_rates', 'view')
  itemUnits(@Query('itemId') itemId?: string) { return this.svc.itemUnits(itemId); }

  @Get('items/:itemId/suppliers') @RequirePermission('purchase_rates', 'view')
  supplierRates(@Param('itemId', ParseUUIDPipe) id: string) { return this.svc.supplierRates(id); }

  @Get('items/:itemId/impact') @RequirePermission('purchase_rates', 'view')
  impact(@Param('itemId', ParseUUIDPipe) id: string, @Query('newRate') newRate?: string) { return this.svc.previewImpact(id, newRate); }

  @Put('items/:itemId/rate') @RequirePermission('purchase_rates', 'manage_rates')
  manual(@CurrentUser() u: AuthUser, @Param('itemId', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.svc.setManualRate(u, id, body); }

  @Post() @RequirePermission('purchase_rates', 'create')
  create(@CurrentUser() u: AuthUser, @Body() body: unknown) { return this.svc.create(u, body); }

  @Delete(':id') @RequirePermission('purchase_rates', 'delete')
  remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.remove(u, id); }

  // ───────── Excel ─────────
  @Get('excel/template') @RequirePermission('purchase_rates', 'import')
  async template(@Res({ passthrough: true }) res: Response) {
    res.set({ 'Content-Type': XLSX, 'Content-Disposition': 'attachment; filename="purchase-rates-template.xlsx"' });
    return new StreamableFile(await this.excel.template());
  }

  @Get('excel/export') @RequirePermission('purchase_rates', 'export')
  async export(@Query() q: Record<string, string>, @Res({ passthrough: true }) res: Response) {
    res.set({ 'Content-Type': XLSX, 'Content-Disposition': 'attachment; filename="purchase-rates.xlsx"' });
    return new StreamableFile(await this.excel.export(q));
  }

  @Post('excel/preview') @RequirePermission('purchase_rates', 'import') @UseInterceptors(upload)
  async preview(@UploadedFile() file?: Express.Multer.File) { return this.excel.summarise(await this.excel.preview(file)); }

  @Post('excel/confirm') @RequirePermission('purchase_rates', 'import') @UseInterceptors(upload)
  confirm(@CurrentUser() u: AuthUser, @UploadedFile() file?: Express.Multer.File, @Query('skipInvalid') skip?: string) {
    return this.excel.confirm(u, file, skip === 'true');
  }

  @Get('excel/history') @RequirePermission('purchase_rates', 'import')
  importHistory() { return this.excel.history(); }
}
