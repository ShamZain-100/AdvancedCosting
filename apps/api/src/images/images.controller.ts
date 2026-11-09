import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res, StreamableFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { PermissionModule } from '@costing/config';
import type { Response } from 'express';
import { AuthUser, CurrentUser, Public, RequireAnyPermission, RequirePermission } from '../common/decorators';
import { MAX_UPLOAD_BYTES } from './image-processor';
import { ImagesService, MAX_FILES_PER_REQUEST, OwnerKind } from './images.service';

const upload = FilesInterceptor('files', MAX_FILES_PER_REQUEST, { limits: { fileSize: MAX_UPLOAD_BYTES, files: MAX_FILES_PER_REQUEST } });

type Access = { view: MethodDecorator & ClassDecorator; create: MethodDecorator & ClassDecorator; edit: MethodDecorator & ClassDecorator; remove: MethodDecorator & ClassDecorator };

function createImagesController(kind: OwnerKind, path: string, access: Access) {
  @ApiTags(`${path}-images`)
  @ApiBearerAuth()
  @Controller(`${path}/:ownerId/images`)
  class OwnerImagesController {
    constructor(readonly images: ImagesService) {}

    @Get() @access.view
    list(@Param('ownerId', ParseUUIDPipe) id: string) { return this.images.list(kind, id); }

    @Post() @access.create @Throttle({ default: { limit: 30, ttl: 60_000 } }) @UseInterceptors(upload)
    upload(@CurrentUser() u: AuthUser, @Param('ownerId', ParseUUIDPipe) id: string, @UploadedFiles() files?: Express.Multer.File[]) { return this.images.upload(u, kind, id, files); }

    @Patch(':imageId') @access.edit
    update(@CurrentUser() u: AuthUser, @Param('ownerId', ParseUUIDPipe) id: string, @Param('imageId', ParseUUIDPipe) imageId: string, @Body() body: unknown) { return this.images.update(u, kind, id, imageId, body); }

    @Delete(':imageId') @access.remove
    remove(@CurrentUser() u: AuthUser, @Param('ownerId', ParseUUIDPipe) id: string, @Param('imageId', ParseUUIDPipe) imageId: string) { return this.images.remove(u, kind, id, imageId); }
  }
  Object.defineProperty(OwnerImagesController, 'name', { value: `${kind}ImagesController` });
  return OwnerImagesController;
}

const byModule = (module: PermissionModule): Access => ({
  view: RequirePermission(module, 'view'), create: RequirePermission(module, 'edit'), edit: RequirePermission(module, 'edit'), remove: RequirePermission(module, 'edit'),
});

/** Costing photos: a costing editor, or a designer (images permission) who sees no costs. */
export const CostingImagesController = createImagesController('costing', 'costings', {
  view: RequireAnyPermission('costing:view', 'images:view'), create: RequireAnyPermission('costing:edit', 'images:create'),
  edit: RequireAnyPermission('costing:edit', 'images:edit'), remove: RequireAnyPermission('costing:edit', 'images:delete'),
});
export const TemplateImagesController = createImagesController('template', 'templates', byModule('templates'));

/** The products a designer works on: names, codes and photos only, never a cost figure. */
@ApiTags('product-images')
@ApiBearerAuth()
@Controller('product-images')
export class ProductImagesController {
  constructor(private readonly images: ImagesService) {}

  @Get() @RequireAnyPermission('images:view', 'costing:view')
  list(@Query() q: Record<string, string>) { return this.images.products(q); }
}


/** Serves private image files to anyone holding a valid, unexpired signed URL (so <img> and print views work). */
@ApiTags('files')
@Controller('files')
export class FilesController {
  constructor(private readonly images: ImagesService) {}

  @Public() @SkipThrottle() @Get(':id')
  async file(@Param('id') id: string, @Query('v') v: string, @Query('exp') exp: string, @Query('sig') sig: string, @Res({ passthrough: true }) res: Response) {
    const { stream } = await this.images.open(id, v, exp, sig);
    res.set({
      'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline', 'Cache-Control': 'private, max-age=300',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    return new StreamableFile(stream);
  }
}
