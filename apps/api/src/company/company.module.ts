import { Global, Module } from '@nestjs/common';
import { CompanyController } from './company.controller';
import { CompanyService } from './company.service';

@Global()
@Module({ controllers: [CompanyController], providers: [CompanyService], exports: [CompanyService] })
export class CompanyModule {}
