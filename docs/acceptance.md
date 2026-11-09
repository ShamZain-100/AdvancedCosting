# Acceptance review

Honest status against the 22 final acceptance criteria. "Automated" means a test in this repository covers the logic with a mocked database; "Not exercised" means nothing has run it end to end. **No part of the application has been run against a real PostgreSQL or clicked through in a browser**, so every row below should be read with that limit.

| # | Criterion | Built | Evidence | Gap |
|---|---|---|---|---|
| 1 | Admin manages every master | Types, groups, categories, items, units, suppliers, labour, expenses, conversions, customers: list/create/edit/status/soft-delete | `master.service.spec`, route audit (Admin reaches every route) | UI pages not browsed |
| 2 | Admin controls permissions per user | 22 modules x 10 actions; roles; per-user allow/deny | `permissions.spec`, `guards.spec`, `route-audit.spec` | UI not browsed |
| 3 | Type -> Group -> Category -> Item hierarchy | Enforced on masters, templates and costings | `templates.service.spec` (wrong group/category/item rejected), schema FKs | |
| 4 | Multiple units and conversions | Item unit conversions, area conversions, unit compatibility checks | `units.spec`, `costings.service.spec` (per metre = 3.15 kg) | |
| 5 | Minimum, maximum, average rates | Rate basis per material row, with fallback warning | `costings.service.spec`, `purchase-rates.service.spec` | |
| 6 | Suppliers connected to purchase rates | Purchase entries, supplier rates, default supplier, history | `purchase-rates.service.spec`, `change-sources.spec` | |
| 7 | Labour per group | Labour rows belong to a costing group | `costing.spec`, `costings.service.spec` | |
| 8 | Expense and wastage maths | Fixed / percentage / quantity expenses, before/after GST; wastage at item/category/group/overall level, most-specific or cumulative | `costing.spec`, `costing.invariants.spec` (randomised), `costing.edge.spec` | |
| 9 | Costing from template or scratch | Both; the template version used is stored | `costings.service.spec` (payload to figures) | Instantiating from a template is done by the web form; no dedicated server test |
| 10 | Save a costing as a template | `POST /costings/:id/save-as-template`: structure and defaults, no prices, photos copied | `costings.template.spec` (added in this phase; there was no test before) | |
| 11 | Product images | Upload, re-encode, main image, limits, signed URLs, copy to templates/documents | `images.service.spec`, `image-processor.spec` | Not seen on screen |
| 12 | Automatic calculation | Server calculates every preview and save; the browser does no money maths | engine and `costings.service.spec` | |
| 13 | Rate changes trigger recalculation workflow | Change bus, batches, policy (auto/confirm/manual), preview, apply, dismiss, review flags | `recalc.service.spec`, `costings.recalculate.spec`, `change-sources.spec` | |
| 14 | Approved costings protected | Snapshot pricing, locked against edit/refresh/delete, never recalculated | `costings.service.spec` (approval freezes), `recalc.service.spec`, `workflow.spec` | |
| 15 | Price lists: percentage and fixed profit | Both, caps, minimum price, rounding, GST treatments | `pricing.spec`, `price-lists.service.spec`, `workflow.spec` | |
| 16 | Quotations created and printed | Create, workflow, share link, PDF | `quotations.service.spec`, `print.service.spec` | PDF layout not viewed |
| 17 | Excel import/export | Masters, rates, templates, price lists; history; row limits | `import.service.spec`, `export.service.spec`, `rates-excel.service.spec` | Workbook look not viewed |
| 18 | Professional costing print | Several layouts, portrait/landscape, company header, PDF | `print.service.spec` | PDF fonts are Latin-1 only (rupee sign prints as "Rs.") |
| 19 | Reports with filters | 12 reports in the 6 groups, filters, totals, Excel/PDF | `reports.service.spec` | Aggregation is in the application with a 100,000 row cap |
| 20 | Permissions enforced on the backend | Global guards on every route | `route-audit.spec`, `guards.spec`, service-level checks | |
| 21 | Critical calculation and workflow tests pass | 137 engine + 382 API tests | `pnpm test` | Mocked database only |
| 22 | Production-ready | Docker stack, HTTPS proxy, migrations, backups, health, hardening | `docs/deployment.md`, Phases 17-18 | **Not proven**: images never built, migrations never applied to a real database, nothing browsed |

## Before calling it finished

1. On a test server: `docker compose ... up -d --build`, check the migrations apply (CHECK constraints, partial unique indexes, `pg_trgm`), seed, sign in.
2. Click through one full story: masters -> purchase rate -> template -> costing -> approve -> price list -> quotation -> PDF/Excel -> change a rate and watch the recalculation screen.
3. Run the backup, then the restore drill.
4. Look at the printed costing, quotation and price list PDFs and the exported workbooks.

## Known limitations

- PDF text is Latin-1 only; the rupee sign becomes "Rs." and non-Latin text becomes "?".
- GST is one rate per line; the CGST/SGST/IGST split is not implemented.
- Notifications go to the bell in the app and, where a user turned it on, to browser / phone push; there is no e-mail, and password-reset links go to the server log.
- Area / Conversion rules with a custom formula are stored but never evaluated.
- Reports aggregate in the application, not in SQL.
- The Prisma `package.json#prisma` setting is deprecated (Prisma 7 needs a `prisma.config.ts`).
