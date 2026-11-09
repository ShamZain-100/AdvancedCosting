import { Global, Module } from '@nestjs/common';
import { DealerPricesController } from './dealer-prices.controller';
import { DealerPricesService } from './dealer-prices.service';

/** Global so the costing workflow can keep dealer prices current without a module cycle. */
@Global()
@Module({ controllers: [DealerPricesController], providers: [DealerPricesService], exports: [DealerPricesService] })
export class DealerPricesModule {}
