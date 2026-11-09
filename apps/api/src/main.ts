import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const production = process.env.NODE_ENV === 'production';
  if (production && !process.env.WEB_ORIGIN) throw new Error('WEB_ORIGIN must be set in production');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  // Behind a reverse proxy (nginx, a load balancer) the client address comes from X-Forwarded-For; the throttler, lockout and audit log use it.
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : process.env.TRUST_PROXY);
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { limit: '1mb', extended: true });
  app.disable('x-powered-by');
  app.use(helmet());
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000', credentials: true });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  // API documentation is for development; in production it is only served when asked for explicitly.
  if (!production || process.env.ENABLE_SWAGGER === 'true') {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Costing System API').setVersion('0.1').addBearerAuth().build(),
    );
    SwaggerModule.setup('api/docs', app, doc);
  }

  await app.listen(Number(process.env.API_PORT ?? 4000));
}
bootstrap();
