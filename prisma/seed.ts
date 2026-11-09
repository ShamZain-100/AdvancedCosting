// Thin entry point; logic lives in apps/api so it resolves that app's dependencies.
import { PrismaClient } from '@prisma/client';
import { seed } from '../apps/api/src/seed/seed';

const prisma = new PrismaClient();
seed(prisma).catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
