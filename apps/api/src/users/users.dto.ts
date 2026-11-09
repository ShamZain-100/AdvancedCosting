import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsEmail, IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { PASSWORD_MIN } from '../auth/auth.dto';

export class CreateUserDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(1) @MaxLength(100) name!: string;
  @IsString() @MaxLength(30) @IsOptional() mobile?: string;
  @IsString() @MinLength(PASSWORD_MIN) @MaxLength(128) password!: string;
  @IsArray() @IsUUID('all', { each: true }) @IsOptional() roleIds?: string[];
  @IsArray() @ArrayUnique() @ArrayMaxSize(100) @IsUUID('all', { each: true }) @IsOptional() dealerIds?: string[];
}
export class UpdateUserDto {
  @IsString() @MinLength(1) @MaxLength(100) @IsOptional() name?: string;
  @IsString() @MaxLength(30) @IsOptional() mobile?: string;
  @IsEmail() @IsOptional() email?: string;
}
export class SetStatusDto { @IsBoolean() isActive!: boolean }
export class AdminResetPasswordDto { @IsString() @MinLength(PASSWORD_MIN) @MaxLength(128) newPassword!: string }
export class SetRolesDto { @IsArray() @ArrayUnique() @IsUUID('all', { each: true }) roleIds!: string[] }
export class SetDealersDto { @IsArray() @ArrayUnique() @ArrayMaxSize(100) @IsUUID('all', { each: true }) dealerIds!: string[] }

export class UserPermissionEntry {
  @IsString() key!: string;
  @IsEnum(['ALLOW', 'DENY']) effect!: 'ALLOW' | 'DENY';
}
export class SetUserPermissionsDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => UserPermissionEntry) overrides!: UserPermissionEntry[];
}

export class CreateRoleDto {
  @IsString() @MinLength(1) @MaxLength(60) name!: string;
  @IsString() @MaxLength(255) @IsOptional() description?: string;
  @IsArray() @IsString({ each: true }) @IsOptional() permissionKeys?: string[];
}
export class UpdateRoleDto {
  @IsString() @MinLength(1) @MaxLength(60) @IsOptional() name?: string;
  @IsString() @MaxLength(255) @IsOptional() description?: string;
}
export class SetRolePermissionsDto { @IsArray() @ArrayUnique() @IsString({ each: true }) permissionKeys!: string[] }
