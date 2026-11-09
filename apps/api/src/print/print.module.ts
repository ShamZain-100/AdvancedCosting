import { Module } from '@nestjs/common';
import { PriceListsModule } from '../price-lists/price-lists.module';
import { QuotationsModule } from '../quotations/quotations.module';
import { PrintController } from './print.controller';
import { PrintService } from './print.service';

@Module({ imports: [QuotationsModule, PriceListsModule], controllers: [PrintController], providers: [PrintService] })
export class PrintModule {}
