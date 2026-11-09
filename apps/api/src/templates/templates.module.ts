import { Module } from '@nestjs/common';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

/** Exported so the costing module (Phase 6) can save a costing as a template and load one into a costing. */
@Module({ controllers: [TemplatesController], providers: [TemplatesService], exports: [TemplatesService] })
export class TemplatesModule {}
