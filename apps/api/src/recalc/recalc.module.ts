import { Global, Module } from '@nestjs/common';
import { CostingsModule } from '../costings/costings.module';
import { RecalcController } from './recalc.controller';
import { RecalcService } from './recalc.service';

/** Global so quotations and price lists can clear their review flags without importing this module. */
@Global()
@Module({ imports: [CostingsModule], controllers: [RecalcController], providers: [RecalcService], exports: [RecalcService] })
export class RecalcModule {}
