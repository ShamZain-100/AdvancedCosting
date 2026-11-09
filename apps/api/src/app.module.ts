import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.service';
import { AuthModule } from './auth/auth.module';
import { PurchaseRatesModule } from './purchase-rates/purchase-rates.module';
import { TemplatesModule } from './templates/templates.module';
import { CostingsModule } from './costings/costings.module';
import { PriceListsModule } from './price-lists/price-lists.module';
import { QuotationsModule } from './quotations/quotations.module';
import { ImagesModule } from './images/images.module';
import { CompanyModule } from './company/company.module';
import { DataModule } from './data/data.module';
import { PrintModule } from './print/print.module';
import { ReportsModule } from './reports/reports.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { ChangeBusModule } from './recalc/change-bus';
import { RecalcModule } from './recalc/recalc.module';
import { SettingsModule } from './settings/settings.module';
import { MastersModule } from './masters/masters.module';
import { UsersModule } from './users/users.module';
import { HealthController } from './health/health.controller';

import { NotificationsModule } from './notifications/notifications.module';
import { DealerPricesModule } from './dealer-prices/dealer-prices.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../../.env'] }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    AuditModule,
    AuthModule,
    ChangeBusModule,
    SettingsModule,
    ImagesModule,
    NotificationsModule,
    DealerPricesModule,
    CompanyModule,
    UsersModule,
    MastersModule,
    PurchaseRatesModule,
    TemplatesModule,
    CostingsModule,
    RecalcModule,
    PriceListsModule,
    QuotationsModule,
    DataModule,
    PrintModule,
    ReportsModule,
    MaintenanceModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
