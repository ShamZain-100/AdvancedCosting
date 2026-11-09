import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ChangePasswordDto, LoginDto, ResetPasswordDto } from '../auth/auth.dto';
import { PaginationDto } from '../common/pagination.dto';
import { costingSchema, priceListSchema, templateSchema } from '@costing/validators';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

const errors = async (cls: any, v: object) => (await validate(plainToInstance(cls, v))).flatMap((e) => Object.values(e.constraints ?? {}));

describe('password rules', () => {
  it.each([['short1'], ['allletters'], ['12345678']])('rejects %j as a new password', async (pw) => {
    expect((await errors(ChangePasswordDto, { currentPassword: 'x', newPassword: pw })).length).toBeGreaterThan(0);
    expect((await errors(ResetPasswordDto, { token: 't', newPassword: pw })).length).toBeGreaterThan(0);
  });
  it('accepts letters plus digits, 8 to 128 characters', async () => {
    expect(await errors(ChangePasswordDto, { currentPassword: 'x', newPassword: 'Good-pass-1' })).toEqual([]);
    expect((await errors(ChangePasswordDto, { currentPassword: 'x', newPassword: 'a1'.repeat(65) })).length).toBeGreaterThan(0);
  });
  it('limits the sign-in password length so a huge body cannot be used to burn CPU in the hash', async () => {
    expect((await errors(LoginDto, { email: 'a@x.com', password: 'x'.repeat(129) })).length).toBeGreaterThan(0);
    expect((await errors(LoginDto, { email: `${'a'.repeat(250)}@x.com`, password: 'x' })).length).toBeGreaterThan(0);
  });
});

describe('request size limits', () => {
  it('page size is capped', async () => {
    expect((await errors(PaginationDto, { pageSize: 100000 })).length).toBeGreaterThan(0);
    expect((await errors(PaginationDto, { pageSize: 200 }))).toEqual([]);
  });

  it('a costing cannot carry an unbounded number of rows', () => {
    const uuid = '00000000-0000-4000-8000-000000000001';
    const header = { productName: 'X', typeId: uuid, costingDate: '2026-02-01', gstPercent: '18', markupPercent: '0' };
    const group = { groupId: uuid };
    expect(costingSchema.safeParse({ ...header, groups: Array.from({ length: 51 }, () => group) }).success).toBe(false);
    expect(costingSchema.safeParse({ ...header, groups: [group], expenses: Array.from({ length: 101 }, () => ({ expenseId: uuid })) }).success).toBe(false);
    const mats = Array.from({ length: 301 }, () => ({ itemId: uuid, quantity: '1', unitId: uuid }));
    expect(costingSchema.safeParse({ ...header, groups: [{ groupId: uuid, categories: [{ categoryId: uuid, materials: mats }] }] }).success).toBe(false);
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
    expect(costingSchema.safeParse({ ...header, groups: ids(50).map((groupId) => ({ groupId })) }).success).toBe(true);
  });

  it('templates and price lists are capped too', () => {
    expect(templateSchema.safeParse({ name: 'T', code: 'T', typeId: '00000000-0000-4000-8000-000000000001', groups: Array.from({ length: 51 }, () => ({ groupId: '00000000-0000-4000-8000-000000000001' })) }).success).toBe(false);
    expect(priceListSchema.safeParse({ name: 'P', items: Array.from({ length: 501 }, () => ({})) }).success).toBe(false);
  });
});

describe('production secrets', () => {
  const build = async (env: Record<string, string>, secret?: string) => {
    const saved = { ...process.env };
    Object.assign(process.env, env);
    try {
      const { AuthModule } = await import('../auth/auth.module');
      const meta = Reflect.getMetadata('imports', AuthModule)[0];
      const factory = meta.providers?.find((p: any) => p.useFactory)?.useFactory ?? meta.providers?.[0]?.useFactory;
      return factory({ get: () => secret } as unknown as ConfigService);
    } finally { process.env = saved; }
  };

  it('refuses a missing, short or placeholder JWT secret in production', async () => {
    await expect(build({ NODE_ENV: 'production' }, undefined)).rejects.toThrow();
    await expect(build({ NODE_ENV: 'production' }, 'short')).rejects.toThrow(/32/);
    await expect(build({ NODE_ENV: 'production' }, 'change-me-change-me-change-me-change-me')).rejects.toThrow(/32/);
  });
  it('accepts a long random secret in production, and any secret in development', async () => {
    await expect(build({ NODE_ENV: 'production' }, 'k3Jx9vQe1LmZ7pRt5Yw2NbHc8Ad4SfUo6GiTy0Vn')).resolves.toBeDefined();
    await expect(build({ NODE_ENV: 'development' }, 'dev')).resolves.toBeDefined();
  });
});
