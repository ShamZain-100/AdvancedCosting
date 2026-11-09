import { BadRequestException } from '@nestjs/common';
import { CompanyService } from './company.service';

function make(current: any = null) {
  const prisma: any = { companySettings: { findUnique: jest.fn().mockResolvedValue(current), upsert: jest.fn(), update: jest.fn() } };
  const images: any = {
    signer: { path: (id: string) => `/files/${id}?v=thumb` },
    createStandalone: jest.fn().mockResolvedValue({ id: 'new-logo' }), releaseFile: jest.fn(), readFull: jest.fn().mockResolvedValue(Buffer.from('jpeg')),
  };
  return { svc: new CompanyService(prisma, { log: jest.fn() } as any, images), prisma, images, actor: { id: 'u1' } as any };
}

describe('CompanyService', () => {
  it('returns sensible defaults before anything is configured', async () => {
    const { svc } = make();
    expect(await svc.get()).toMatchObject({ name: 'Your Company', currencyCode: 'INR', logoUrl: null });
  });

  it('validates and saves company details', async () => {
    const { svc, prisma, actor } = make();
    await expect(svc.update(actor, { name: '' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.update(actor, { name: 'Acme', gstin: 'bad' })).rejects.toBeInstanceOf(BadRequestException);
    await svc.update(actor, { name: 'Acme', gstin: '27abcde1234f1z5', currencyCode: 'inr', email: '' });
    const data = prisma.companySettings.upsert.mock.calls[0][0].update;
    expect(data).toMatchObject({ name: 'Acme', gstin: '27ABCDE1234F1Z5', currencyCode: 'INR', email: null, updatedBy: 'u1' });
    expect(data.logoFileId).toBeUndefined(); // the logo is only changed through the logo endpoints
  });

  it('replacing the logo releases the old file', async () => {
    const { svc, images, prisma, actor } = make({ id: 1, name: 'Acme', logoFileId: 'old-logo' });
    await svc.setLogo(actor, { buffer: Buffer.from('x'), originalname: 'logo.png' } as any);
    expect(prisma.companySettings.upsert.mock.calls[0][0].update).toMatchObject({ logoFileId: 'new-logo' });
    expect(images.releaseFile).toHaveBeenCalledWith('old-logo');
  });

  it('removing the logo clears it and releases the file; a missing logo gives no bytes', async () => {
    const { svc, images, prisma, actor } = make({ id: 1, name: 'Acme', logoFileId: 'old-logo' });
    await svc.removeLogo(actor);
    expect(prisma.companySettings.update).toHaveBeenCalledWith({ where: { id: 1 }, data: expect.objectContaining({ logoFileId: null }) });
    expect(images.releaseFile).toHaveBeenCalledWith('old-logo');
    expect(await svc.logoBuffer()).toEqual(Buffer.from('jpeg'));
    const none = make();
    expect(await none.svc.logoBuffer()).toBeNull();
  });
});
