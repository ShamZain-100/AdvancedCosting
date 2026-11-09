import { Module } from '@nestjs/common';
import { CostingsModule } from '../costings/costings.module';
import { PriceListsController } from './price-lists.controller';
import { PriceListsService } from './price-lists.service';

@Module({ imports: [CostingsModule], controllers: [PriceListsController], providers: [PriceListsService], exports: [PriceListsService] })
export class PriceListsModule {}
