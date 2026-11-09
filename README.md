# Smart Costing Management System

Turborepo + pnpm monorepo: Next.js (`apps/web`), NestJS (`apps/api`), Prisma/PostgreSQL (`prisma/`), shared packages (`packages/*`).

## Development setup
```bash
cp .env.example .env
docker compose up -d db
pnpm install
pnpm db:generate && pnpm db:migrate
pnpm dev          # web :3000, api :4000 (Swagger at /api/docs)
pnpm test && pnpm build
```

## Conventions
- All money/quantity maths goes through `@costing/costing-engine` (decimal.js); values cross the API as decimal strings.
- The backend is the source of truth for financial calculations.
- Pinned deliberately: NestJS 11 (v12 is ESM-only, breaks Jest), TypeScript 5.9 (Nest CLI needs the compiler API), Prisma 6.

See `docs/architecture.md` for the phase plan.

## Deployment
See [docs/deployment.md](docs/deployment.md) (Docker Compose with automatic HTTPS, backups, monitoring).
