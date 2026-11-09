import { Module } from '@nestjs/common';
import { DashboardController } from '../dashboard/dashboard.controller';
import { DashboardService } from '../dashboard/dashboard.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({ controllers: [ReportsController, DashboardController], providers: [ReportsService, DashboardService] })
export class ReportsModule {}
