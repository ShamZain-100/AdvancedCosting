import { Global, Module } from '@nestjs/common';
import { PurchaseRatesController } from './purchase-rates.controller';
import { PurchaseRatesService } from './purchase-rates.service';
import { RateImpactService } from './rate-impact.service';
import { RatesExcelService } from './rates-excel.service';

/** Global so later modules (costing, quotations) can inject RateImpactService and register their impact provider. */
@Global()
@Module({
  controllers: [PurchaseRatesController],
  providers: [PurchaseRatesService, RatesExcelService, RateImpactService],
  exports: [RateImpactService, PurchaseRatesService],
})
export class PurchaseRatesModule {}
