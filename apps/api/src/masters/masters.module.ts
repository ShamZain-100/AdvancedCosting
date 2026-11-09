import { Module } from '@nestjs/common';
import { createMasterController } from './master.controller';
import { MasterService } from './master.service';
import { MASTERS } from './masters.config';

@Module({ controllers: MASTERS.map(createMasterController), providers: [MasterService], exports: [MasterService] })
export class MastersModule {}
