import { Body, Controller, Delete, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { TemplatesService } from './templates.service';

@ApiTags('templates')
@ApiBearerAuth()
@Controller('templates')
export class TemplatesController {
  constructor(private readonly svc: TemplatesService) {}

  @Get() @RequirePermission('templates', 'view')
  list(@Query() q: Record<string, string>) { return this.svc.list(q); }

  @Get(':id') @RequirePermission('templates', 'view')
  get(@Param('id', ParseUUIDPipe) id: string) { return this.svc.get(id); }

  @Get(':id/versions') @RequirePermission('templates', 'view')
  versions(@Param('id', ParseUUIDPipe) id: string) { return this.svc.versions(id); }

  @Get(':id/versions/:version') @RequirePermission('templates', 'view')
  version(@Param('id', ParseUUIDPipe) id: string, @Param('version', ParseIntPipe) v: number) { return this.svc.version(id, v); }

  @Post() @RequirePermission('templates', 'create')
  create(@CurrentUser() u: AuthUser, @Body() body: unknown) { return this.svc.create(u, body); }

  @Post(':id/duplicate') @RequirePermission('templates', 'create')
  duplicate(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.svc.duplicate(u, id, body); }

  @Put(':id') @RequirePermission('templates', 'edit')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.svc.update(u, id, body); }

  @Patch(':id/status') @RequirePermission('templates', 'edit')
  status(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.svc.setStatus(u, id, body); }

  @Delete(':id') @RequirePermission('templates', 'delete')
  remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.remove(u, id); }
}
