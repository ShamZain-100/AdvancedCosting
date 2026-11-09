import { Module } from '@nestjs/common';
import { CostingsModule } from '../costings/costings.module';
import { MastersModule } from '../masters/masters.module';
import { PriceListsModule } from '../price-lists/price-lists.module';
import { TemplatesModule } from '../templates/templates.module';
import { DataController } from './data.controller';
import { ExportService } from './export.service';
import { ImportService } from './import.service';

@Module({
  imports: [MastersModule, TemplatesModule, PriceListsModule, CostingsModule],
  controllers: [DataController],
  providers: [ImportService, ExportService],
})
export class DataModule {}
