import { Global, Module } from '@nestjs/common';
import { CostingImagesController, FilesController, ProductImagesController, TemplateImagesController } from './images.controller';
import { FileStorageService } from './file-storage.service';
import { ImagesService } from './images.service';

/** Global so costing, price list and quotation services can ask for main images without importing this module. */
@Global()
@Module({ controllers: [CostingImagesController, TemplateImagesController, ProductImagesController, FilesController], providers: [FileStorageService, ImagesService], exports: [ImagesService, FileStorageService] })
export class ImagesModule {}
