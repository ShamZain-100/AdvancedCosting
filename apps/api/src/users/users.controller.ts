import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { PaginationDto } from '../common/pagination.dto';
import { UsersService } from './users.service';
import { AdminResetPasswordDto, CreateUserDto, SetDealersDto, SetRolesDto, SetStatusDto, SetUserPermissionsDto, UpdateUserDto } from './users.dto';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get() @RequirePermission('users', 'view')
  list(@Query() q: PaginationDto) { return this.users.list(q); }

  @Get(':id') @RequirePermission('users', 'view')
  get(@Param('id', ParseUUIDPipe) id: string) { return this.users.get(id); }

  @Get(':id/activity') @RequirePermission('users', 'view')
  activity(@Param('id', ParseUUIDPipe) id: string, @Query() q: PaginationDto) { return this.users.activity(id, q.page, q.pageSize); }

  @Post() @RequirePermission('users', 'create')
  create(@CurrentUser() a: AuthUser, @Body() dto: CreateUserDto) { return this.users.create(a, dto); }

  @Patch(':id') @RequirePermission('users', 'edit')
  update(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) { return this.users.update(a, id, dto); }

  @Patch(':id/status') @RequirePermission('users', 'edit')
  status(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetStatusDto) { return this.users.setStatus(a, id, dto.isActive); }

  @Post(':id/reset-password') @RequirePermission('users', 'manage_settings')
  reset(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminResetPasswordDto) { return this.users.resetPassword(a, id, dto.newPassword); }

  @Post(':id/unlock') @RequirePermission('users', 'manage_settings')
  unlock(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.users.unlock(actor, id); }

  @Put(':id/dealers') @RequirePermission('users', 'manage_settings')
  dealers(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetDealersDto) { return this.users.setDealers(a, id, dto.dealerIds); }

  @Put(':id/roles') @RequirePermission('users', 'manage_settings')
  roles(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetRolesDto) { return this.users.setRoles(a, id, dto.roleIds); }

  @Put(':id/permissions') @RequirePermission('users', 'manage_settings')
  permissions(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetUserPermissionsDto) { return this.users.setOverrides(a, id, dto.overrides); }
}
