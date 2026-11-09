# Database design

PostgreSQL via Prisma, 49 models (all 42 entities of the specification plus supporting tables such as `NumberSequence`, `TemplateVersion`, `CostingRevision`, `QuotationShare`, `Session`). The schema is `prisma/schema.prisma`; migrations are in `prisma/migrations` and are applied in order with `pnpm db:migrate` (development) or `prisma migrate deploy` (production).

## Conventions
- **Keys**: UUID text primary keys (`@default(uuid())`). Exceptions: `NumberSequence` (string key), the two single-row settings tables (`id = 1`), and join tables with composite keys.
- **Numbers**: money, rates, quantities and percentages are `Decimal` with explicit precision; there is no `Float` anywhere.
- **Soft delete**: masters and documents carry `deletedAt`; the code / symbol of a deleted row is suffixed `~deleted~<id>` so it can be reused. Rows referenced by other live records cannot be deleted (checked by the API, and by foreign keys as the last line of defence).
- **Audit columns**: `createdAt`/`updatedAt` everywhere; `createdBy`/`updatedBy` on masters, templates, costings, price lists, quotations and customers. Purchase entries are immutable (`createdAt`, `createdBy`, `deletedAt`). Every important change also writes an `AuditLog` row.
- **Snapshots and history**: costings, quotations and price list items store the figures and rules they were calculated with; approved costings are frozen (`SNAPSHOT`). `TemplateVersion` and `CostingRevision` keep a full snapshot per save; `PurchaseRateHistory` is an append-only rate log.

## Integrity enforced by the database
- **Foreign keys** never silently null or cascade away history: optional references to masters and documents (`Item.defaultSupplier`, `PurchaseRate.supplier`, `Costing.template`, `Quotation.customer`, `QuotationItem.costing`, `AreaConversion.item`, labour/unit/type references, the company logo…) are `ON DELETE RESTRICT`. Cascades exist only from a document to the rows it owns (a costing to its groups, categories, materials, labour and expenses; a template to its tree; a quotation to its lines, …).
- **CHECK constraints** (69, in the Phase 13 migration): quantities > 0, rates / prices / amounts ≥ 0, percentages 0–100, min ≤ max, unit precision 0–6, conversion factors > 0, allowed values of the text-typed price list options.
- **Partial unique indexes**: at most one main image per costing and per template; at most one default supplier per item.

## Indexes
- **Every foreign key column is indexed** (PostgreSQL does not do this automatically); this keeps joins, cascading deletes and the "is this master still used?" checks fast.
- **Lists and reports**: `Costing(deletedAt, costingDate)`, `Quotation(deletedAt, quotationDate)`, `Quotation(status, validUntil)` (expiry sweep), `PurchaseRate(supplierId, itemId, purchaseDate)`, `PurchaseRate(itemId, purchaseDate)`, `PurchaseRateHistory(itemId, changedAt)`, `AuditLog(entity, entityId)` and `(createdAt)`, plus the status / type / date indexes added in earlier phases.
- **Search**: the screens search with `ILIKE '%text%'`, which ordinary indexes cannot use. `pg_trgm` GIN indexes cover item name/code, costing product name/number, customer name, supplier name/code, quotation customer/number and template name.

## Queries reviewed in this phase
- Template list: item counts come from one grouped SQL query (was: load every template line).
- Dashboard: "products" is `COUNT(DISTINCT productName)` in SQL (was: fetch a row per product).
- Quotation expiry sweep runs at most every 30 s per process on reads (always before status changes / share links) instead of on every request.
- Reports aggregate in the application over filtered, indexed queries and refuse to run past 100,000 source rows; move the heaviest ones to SQL views if a database ever grows past that.

## Housekeeping
`MaintenanceService` removes finished throw-away rows only: sessions expired/revoked > 30 days, password-reset tokens used/expired > 7 days, quotation share links expired/revoked > 90 days. It starts 1 minute after boot and then every 6 hours (`DISABLE_MAINTENANCE=true` turns it off). Audit logs, rate history, import history, revisions and all business records are kept; decide a retention policy for `AuditLog` once volumes are known.

## Tests that guard the design
`apps/api/src/database/schema.spec.ts` reads the schema and migrations and fails if: a required entity is missing, a `Float` appears, money-named columns are not `Decimal`, a foreign key lacks an index, an optional relation relies on the default SET NULL, a protected reference is not RESTRICT, cascades appear outside the owned-children list, a soft-deletable table lacks timestamps, or any migration is not valid PostgreSQL (checked with the real Postgres parser, `libpg-query`). It also checks that every CHECK constraint and partial index names a real table and columns.

## Notes for operators
- The CHECK constraints and partial indexes are plain SQL inside the Phase 13 migration: Prisma does not model CHECK constraints, and partial indexes are not part of the schema file. If `prisma migrate dev` ever proposes to drop a partial index, remove that statement from the generated migration. Run `prisma migrate diff --from-migrations … --to-schema-datamodel …` against a scratch database in CI to confirm.
- The migration fails loudly if existing rows already violate a constraint; fix those rows and re-run (the application's own validation has enforced all of these ranges since the phase that introduced each table).
- The trigram indexes need the `pg_trgm` extension (the migration runs `CREATE EXTENSION IF NOT EXISTS`); managed Postgres services allow it, but the database user needs the privilege.
- Phase 14 adds `RecalculationBatch`, `RecalculationItem`, `ReviewFlag`, `CostingExpense.overrideFields` and the recalculation policy columns on `CostingSettings`; their FK indexes, CHECK constraints and partial unique indexes are in the Phase 14 migration.
