import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { AuditService } from '../audit/audit.service';
import { RolesService } from './roles.service';
import { CreateRoleDto, SetRolePermissionsDto, UpdateRoleDto } from '../users/users.dto';

class AuditQuery {
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(200) @IsOptional() pageSize = 50;
  @IsString() @IsOptional() entity?: string;
  @IsString() @IsOptional() userId?: string;
}

@ApiTags('roles')
@ApiBearerAuth()
@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService, private readonly audit: AuditService) {}

  @Get('roles') @RequirePermission('roles', 'view')
  list() { return this.roles.list(); }

  @Get('permissions') @RequirePermission('roles', 'view')
  catalog() { return this.roles.catalog(); }

  @Post('roles') @RequirePermission('roles', 'create')
  create(@CurrentUser() a: AuthUser, @Body() dto: CreateRoleDto) { return this.roles.create(a, dto); }

  @Patch('roles/:id') @RequirePermission('roles', 'edit')
  update(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoleDto) { return this.roles.update(a, id, dto); }

  @Put('roles/:id/permissions') @RequirePermission('roles', 'edit')
  setPerms(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetRolePermissionsDto) { return this.roles.setPermissions(a, id, dto.permissionKeys); }

  @Delete('roles/:id') @RequirePermission('roles', 'delete')
  remove(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.roles.remove(a, id); }

  @Get('audit-logs') @RequirePermission('audit_logs', 'view')
  logs(@Query() q: AuditQuery) { return this.audit.list(q); }
}
