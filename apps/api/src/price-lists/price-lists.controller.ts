import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { PriceListsService } from './price-lists.service';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@ApiTags('price-lists')
@ApiBearerAuth()
@Controller('price-lists')
export class PriceListsController {
  constructor(private readonly svc: PriceListsService) {}

  @Get() @RequirePermission('price_lists', 'view')
  list(@Query() q: Record<string, string>) { return this.svc.list(q); }

  @Post('preview') @RequirePermission('price_lists', 'view')
  preview(@Body() body: unknown) { return this.svc.preview(body); }

  @Post('generate') @RequirePermission('price_lists', 'create')
  generate(@CurrentUser() u: AuthUser, @Body() body: unknown) { return this.svc.generate(u, body); }

  @Get(':id') @RequirePermission('price_lists', 'view')
  get(@Param('id', ParseUUIDPipe) id: string) { return this.svc.get(id); }

  @Get(':id/export') @RequirePermission('price_lists', 'export')
  async export(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    res.set({ 'Content-Type': XLSX, 'Content-Disposition': 'attachment; filename="price-list.xlsx"' });
    return new StreamableFile(await this.svc.exportExcel(id));
  }

  @Post() @RequirePermission('price_lists', 'create')
  create(@CurrentUser() u: AuthUser, @Body() body: unknown) { return this.svc.create(u, body); }

  @Put(':id') @RequirePermission('price_lists', 'edit')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.svc.update(u, id, body); }

  @Post(':id/items') @RequirePermission('price_lists', 'edit')
  add(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.svc.addCostings(u, id, body); }

  @Post(':id/reprice') @RequirePermission('price_lists', 'edit')
  reprice(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.reprice(u, id); }

  @Patch(':id/status') @RequirePermission('price_lists', 'edit')
  status(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.svc.setStatus(u, id, body); }

  @Delete(':id') @RequirePermission('price_lists', 'delete')
  remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.remove(u, id); }
}
