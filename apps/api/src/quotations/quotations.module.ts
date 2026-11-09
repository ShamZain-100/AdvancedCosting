import { Module } from '@nestjs/common';
import { CostingsModule } from '../costings/costings.module';
import { PublicQuotationsController, QuotationsController } from './quotations.controller';
import { QuotationsService } from './quotations.service';

@Module({ imports: [CostingsModule], controllers: [QuotationsController, PublicQuotationsController], providers: [QuotationsService], exports: [QuotationsService] })
export class QuotationsModule {}
