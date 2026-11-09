import { Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { MasterService } from './master.service';
import type { MasterConfig } from './master.types';

/** Builds a REST controller (list/get/create/update/status/delete) for a master config. */
export function createMasterController(cfg: MasterConfig) {
  @ApiTags(cfg.path)
  @ApiBearerAuth()
  @Controller(cfg.path)
  class MasterController {
    constructor(@Inject(MasterService) readonly svc: MasterService) {}

    @Get() @RequirePermission(cfg.module, 'view')
    list(@Query() q: Record<string, string>) { return this.svc.list(cfg, q); }

    @Get(':id') @RequirePermission(cfg.module, 'view')
    get(@Param('id', ParseUUIDPipe) id: string) { return this.svc.get(cfg, id); }

    @Post() @RequirePermission(cfg.module, 'create')
    create(@CurrentUser() u: AuthUser, @Body() body: unknown) { return this.svc.create(cfg, u, body); }

    @Put(':id') @RequirePermission(cfg.module, 'edit')
    update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.svc.update(cfg, u, id, body); }

    @Patch(':id/status') @RequirePermission(cfg.module, 'edit')
    status(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: { isActive?: unknown }) { return this.svc.setStatus(cfg, u, id, body?.isActive); }

    @Delete(':id') @RequirePermission(cfg.module, 'delete')
    remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.remove(cfg, u, id); }
  }
  Object.defineProperty(MasterController, 'name', { value: `${cfg.entity}Controller` });
  return MasterController;
}
