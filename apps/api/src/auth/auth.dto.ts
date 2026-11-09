import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export const PASSWORD_MIN = 8;
const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).+$/;
const PASSWORD_MESSAGE = 'Password must contain at least one letter and one digit';

export class LoginDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(1) @MaxLength(128) password!: string;
}
export class ForgotPasswordDto {
  @IsEmail() email!: string;
}
export class ResetPasswordDto {
  @IsString() token!: string;
  @IsString() @MinLength(PASSWORD_MIN) @MaxLength(128) @Matches(PASSWORD_RULE, { message: PASSWORD_MESSAGE }) newPassword!: string;
}
export class ChangePasswordDto {
  @IsString() currentPassword!: string;
  @IsString() @MinLength(PASSWORD_MIN) @MaxLength(128) @Matches(PASSWORD_RULE, { message: PASSWORD_MESSAGE }) newPassword!: string;
}
export class UpdateProfileDto {
  @IsString() @MinLength(1) @MaxLength(100) @IsOptional() name?: string;
  @IsString() @MaxLength(30) @IsOptional() mobile?: string;
}
