import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators';
import type { HealthStatus } from '@costing/types';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check(): Promise<HealthStatus> {
    const database = await this.prisma.$queryRaw`SELECT 1`.then(() => 'up' as const, () => 'down' as const);
    const body: HealthStatus = { status: 'ok', database, timestamp: new Date().toISOString() };
    // Load balancers, Docker and uptime monitors look at the status code: 503 while the database is unreachable.
    if (database === 'down') throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    return body;
  }
}
