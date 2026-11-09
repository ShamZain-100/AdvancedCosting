# Smoke test report (live Docker stack)

Run against the running stack (API, web, PostgreSQL, Caddy) through the browser session of a dedicated smoke admin
(`deploy/smoke-admin.sh`). All test data carries the prefix **SMK**. Parts 1 and 2 of the business extension (customer groups, now price list dealers,
company expense, extra %) were on the stack; parts 3-6 are not built yet.

**Result: 273 API checks, 272 passed, 1 failed. 64 of 64 pages loaded without errors.**

| Area | Checks | Passed |
|---|---|---|
| Core, auth, dashboard, 11 masters (create, get, search, update, deactivate, duplicate and invalid input, delete guards) | 87 | 87 |
| Templates and costing lifecycle (hand-checked figures, approval workflow, frozen guards, save-as-template) | 34 | 33 |
| Purchase rates and recalculation (batch, preview, apply, dismiss, AUTO policy, frozen costings) | 18 | 18 |
| Price lists and quotations (figures, workflow, share links, public view) | 31 | 31 |
| Print, export, import, 12 reports (data, Excel, PDF), images, company settings | 44 | 44 |
| Users, per-role and per-user permissions as a real Staff user, group assignment | 21 | 21 |
| Roles, settings, approval enforcement, password reset, audit log | 26 | 26 |
| Security (lockout, headers, body limit, no Swagger, reset flow, throttle) | 12 | 12 |

## The one failure
Toggling a company expense on or off (or creating one) did not queue a recalculation batch. The fix is in the source and covered
by unit tests (`company-expense-events.spec.ts`) but the running API image predates it: editing the expense did queue a batch. **Rebuild
the images and re-test.**

## Verified with exact figures (all match hand calculation)
- Costing: 10 kg x 100 + labour 550 + packing 60 + company expense 100 = basic 1,710.00; GST 307.80; total 2,017.80; markup 201.78; selling 2,219.58.
- Extra 5 %: extra 100.89, markup 211.87, selling 2,330.56.
- Rate change 100 -> 120 -> 140: live costing 2,479.18 -> 2,738.78; approved costings stayed at 2,219.58.
- Price list at 25 % profit: 2,137.50 ex GST, GST 384.75, 2,522.25 incl GST. Quotation: taxable 5,052, GST 909.36, total 5,961.36.
- Forged `sellingPrice` / `basicCost` in a request body are ignored (server recalculates).

## Behaviour confirmed, not defects
- Only sent or approved quotations can be shared; the public link hides costs and the preparer is shown by name only.
- Conversions have no unique code, so a duplicate name is accepted.
- Sign-in is limited to 10 attempts a minute per address (the smoke script hit it once); five wrong passwords lock an account for 15 minutes.
- Approved costings refuse photo changes (the designer exception comes in part 4).

## Not covered by this smoke test
- Excel import with a filled workbook (only templates, empty-file preview and a non-Excel file were tested; the browser has no spreadsheet writer).
- Visual layout beyond the printed costing sheet (the other 63 pages were checked structurally: heading, content, no failed API call).
- Refresh-token theft detection (unit-tested only), HTTPS and certificates (the trial runs on http://localhost).
- Backup and restore scripts, and the production deployment on a real domain.

## Test data left behind
Masters `SMK ...` (type, group, category, unit, supplier, labour, expense, 2 conversions, item, customer group, customer), 3 templates,
costings A, B (approved), C (draft with a photo), a staff-made costing (approved) and two more (one forged-body test, one pending approval),
an SMK price list, quotations, purchase entries, users `smk.staff`, `smk.lock` and `smoke@example.com`.
Approved or used records cannot be deleted by design. A pending "Company expense" recalculation batch from the probe is left on
purpose so the post-rebuild re-test can be done. Delete the smoke users in the app when finished.

## Re-test after a clean rebuild (old containers and images removed, volumes kept)
**Result: 29 further API checks passed, 65 of 65 pages loaded without errors in the new UI (the 4 public pages correctly have no sidebar).**

- **The earlier failure is fixed and verified live:** deactivating a company expense queues a `COMPANY_EXPENSE` batch; creating a new active company expense is announced and named in the batch; the batch preview lists the live costings it would change; an unused extra company expense can be removed again.
- **Applying the batch:** the demo costing moved from 5,623.49 to 5,759.78 (Factory rent 100 added, extra 249.34, company expense cost 100 stored). Approved costings stayed frozen, the costing waiting for approval was skipped, and live costings that already carried the rent were unchanged.
- **Outputs on the rebuilt stack:** all 12 reports (data, Excel, PDF), every export kind and import template, 5 costing PDF modes, price list and quotation PDF/Excel, costing workbook, dashboard/audit/settings/users/roles endpoints.
- **New UI checked in the browser:** gradient sign-in screen; dark indigo sidebar, fixed to the left edge (stays put while the page scrolls) and expanded by default (10 coloured categories, 43 pages); folding a category (the category with the current page cannot be folded away); collapse to a 76 px icon rail; choice remembered after a reload; phone width gives a slide-in drawer with a blurred overlay and no horizontal scroll; coloured dashboard tiles, status badges and tinted tables.
- Sidebar state was reset to the default (expanded) after the test.
