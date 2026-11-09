import { Module } from '@nestjs/common';
import { TemplatesModule } from '../templates/templates.module';
import { CostingSettingsService } from './costing-settings.service';
import { CostingsController } from './costings.controller';
import { CostingsService } from './costings.service';

@Module({
  imports: [TemplatesModule],
  controllers: [CostingsController],
  providers: [CostingsService, CostingSettingsService],
  exports: [CostingsService, CostingSettingsService],
})
export class CostingsModule {}
