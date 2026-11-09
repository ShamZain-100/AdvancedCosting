import { Global, Module } from '@nestjs/common';
import { NumberingService } from './numbering.service';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

/** Global: costings, quotations and price lists ask it for numbering and for the approval workflow. */
@Global()
@Module({ controllers: [SettingsController], providers: [SettingsService, NumberingService], exports: [SettingsService, NumberingService] })
export class SettingsModule {}
