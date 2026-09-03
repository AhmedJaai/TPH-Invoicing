# TPH Invoicing — Technical Handover

**Repository:** `AhmedJaai/TPH-Invoicing` · **Branch:** `main` · **HEAD:** `7b9c78e`
**Production:** https://tph-invoicing.vercel.app (Vercel project `tph4/tph-invoicing`)
**Report generated:** 2026-09-03, from direct inspection of the working tree, the live Neon database, and the live production deployment.

> Everything in this report was verified against the actual code, a live `SELECT` against the production database, or a live HTTP request. Anything I could not verify is marked `[UNKNOWN]`. Claims that came from conversation history but are not visible in the code are marked as such.

---

## REVISION 2 — 2026-09-03, later the same day

The report below was written before a remediation pass. **Sections 1 and 3–15 remain accurate as descriptions of architecture and mechanism. The following facts changed.** Where a section below contradicts this block, this block is current.

**Fixed**

| Was | Now |
|---|---|
| `/api/archive` trusted client-supplied `isTaxValid` / `inputVatEligible` / `isFixedAsset` / `findings` (§2 BROKEN #1, §10.1) | Server recomputes all of them in `src/lib/confirm.ts` (`reviewConfirmed`, 13 tests) before the Drive upload. Client flags are ignored; the blocker gate uses server findings. |
| Silent invoice loss when `total` or the invoice number was unparseable (§2 BROKEN #3) | Rejected with `409` and an explicit message naming what is missing. Nothing reaches Drive. |
| `TaxInvoice` missing from `TYPE_TOKENS` (§2 BROKEN #4) | Added. The 11,600 SAR SardTrading invoice is now in the database. |
| `mark-paid` / `bank-import` writing `action: "DOCUMENT_ARCHIVED"` (§2 BROKEN #7) | Now `INVOICES_MARKED_PAID` and `BANK_IMPORTED`; `DRIVE_SYNCED` and `SUPPLIER_ALIAS_LEARNED` added. |
| `invoice_lines` held 1 row; 122/123 invoices had `vat = 0` (§2 PARTIAL) | Content backfill read **140 archive files with 0 failures**. See the new counts below. |
| 153/154 documents had `sha256 = NULL` (§2 PARTIAL) | All **157** documents now hashed and carry `extraction_json`. |
| No in-app Drive refresh (§2 PLANNED) | `POST /api/drive-sync` + a "افحص الدرايف عن ملفات جديدة" panel on `/`. Diffs Drive file IDs against `documents`, recent-3-months by default, reads content for files whose names can't be parsed. Shared walker in `src/lib/drive-sync.ts`; import planner in `src/lib/archive-import.ts` (8 tests). |
| No way to teach bank beneficiary names (§19 P1 #9) | `POST /api/supplier-alias` + a per-transaction supplier dropdown and editable alias field on `/bank`, pre-filled by `suggestAlias()`. Saves as `kind: BANK_BENEFICIARY, source: LEARNED`, then "re-match with the new names". |

**New live counts (verified by SELECT)**

`users 1 · suppliers 24 · supplier_aliases 86 · documents 157 (all hashed, all extracted) · invoices 126 · invoice_lines 291 (108 distinct items) · statements 11 · statement_lines 0 · payments 27 · payment_allocations 47 · bank_imports 1 · bank_transactions 1428 · issues 0 · month_closes 0 · audit_logs 2`

`invoices`: total **130,178.41 SAR** · `is_tax_valid` **56** (was 1) · `vat_minor > 0` **65** (was 1) · fixed assets 5 · **recoverable input VAT 11,158.82 SAR** · **VAT at risk 1,414.87 SAR across 9 invoices** (previously reported as a false "0").

Tests: **240 passing, 17 files** (was 215/15).

**New finding — the model fabricates invoice numbers with confidence 1.0.** On an invoice carrying no printed number, `gemini-3.5-flash-lite` returned `TPH-20260521` — assembled from the company's initials and the date — and reported `confidence.invoiceNumber = 1.0`. **Model self-reported confidence is therefore not a usable guard against fabrication.** Mitigation applied: the backfill never takes an invoice number from the model for a document that came from the archive; such documents are reported for manual entry. The one fabricated row was deleted. An explicit prohibition was added to the shared prompt.

**New finding — Gemini free tier is 20 requests per DAY per model**, not per minute (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`, quotaValue 20, for `gemini-3.8-flash`, which is what `gemini-flash-latest` resolves to). Quotas are per-model and independent, so `scripts/backfill-content.ts` rotates through seven models (`GEMINI_MODELS`) and exits cleanly when all are exhausted, resuming on the next run. This is a hard constraint on any future bulk re-read.

**Backfill safety rule (unchanged, and it earned its keep):** the script never writes an amount over one a human wrote in a filename. Three files disagreed and were reported, not overwritten — `CoffeeLabs V405523` (678.10 vs 678.00), and two Rawnah invoices whose totals the model could not read.

**Still open from §16/§19:** statement reconciliation, month close, alerts, accounting export, documents browser, issues UI, supplier CRUD, rate limiting, generated migrations, `AUTH_BYPASS` present in production, key rotation, and the preview-vs-production database question.

Revised production readiness: **~68%** (from ~55%). The write-path integrity hole is closed and the data is real; the remaining gap is missing subsystems and operational hardening, not architecture.

---

## 1. EXECUTIVE SUMMARY

### What is this application?

A single-tenant Arabic (RTL) web application that manages the **purchase-invoice lifecycle** for one business: **مؤسسة ذا بوبليك هاوس** (The Public House), a café in Al-Naseem, Jeddah, Saudi Arabia. VAT number `310007971600003`, CR `7052766941`.

It is *not* a general accounting system and is not multi-tenant. Company identity, Drive folder IDs, supplier list, and the bank statement format are all specific to this one business.

### What business problem is it solving?

Supplier invoices arrive by WhatsApp from ~20 suppliers with random filenames. They were filed manually into a Google Drive archive. The stated failure modes that motivated the project:

- Posting errors (an invoice of 3,400 SAR booked as 1,700).
- Quotations and proforma invoices posted as if they were real invoices.
- Simplified invoices (no buyer VAT number) accepted, silently losing input-VAT deduction.
- Duplicate payments to the same supplier.
- One supplier issuing only monthly statements and no invoices for four months.
- No single place to see what is owed, what is paid, and what prices changed.

### Intended user

Three roles are modelled (`OWNER`, `ACCOUNTANT`, `PURCHASING`). In practice today there is **one real user**: the owner, `ahmedaljaaidi98@gmail.com`, hardcoded into `ALLOWED_EMAILS`. The database contains exactly 1 user row.

### Complete end-to-end workflow (as built)

```
WhatsApp/photo → drag-drop into web app → POST /api/analyze
  → Gemini reads the PDF/image → structured JSON extraction
  → supplier matched against DB registry → validation rules run
  → proposed filename + Drive folder computed
  → human reviews & edits in the browser → POST /api/archive
  → file uploaded to Google Drive under the user's own OAuth token
  → document/invoice/lines/statement/payment rows written in one transaction
  → audit log entry written (immutable)
Then, separately:
  bank statement .xlsx → POST /api/bank-import (preview) → (apply)
  → payments + payment_allocations created → invoices become "paid"
  OR: POST /api/mark-paid → owner asserts everything is paid
Reporting pages read the DB and compute KPIs in TypeScript.
```

### What the application can currently do

- Read an uploaded PDF or image with a vision LLM and extract ~16 structured fields.
- Classify the document into 10 kinds (tax invoice, simplified invoice, statement, quotation, proforma, receipt, cash receipt, contract, utility, unknown).
- Match the supplier by VAT → alias → exact name → fuzzy, with human confirmation for weak matches.
- Apply Saudi VAT validity rules and produce blocking/warning findings.
- Propose an archive filename and Drive folder path following the existing archive conventions.
- Upload to Google Drive without ever overwriting, moving, renaming, or deleting an existing file.
- Record everything in Postgres with an append-only audit log enforced by database triggers.
- Parse a Saudi National Bank (SNB/الأهلي) Excel statement, exclude operational noise, match transfers to suppliers by distinctive-token matching, find invoice combinations that sum to a transfer amount, and detect suspected duplicate payments.
- Render six reporting/operational pages plus an upload page.
- Generate a month payment run as a CSV for bulk bank transfer, holding back invoices that are not fully tax-valid.
- Produce ranked, Arabic, actionable recommendations from the data.

### What it is supposed to become

From `docs/PLAN.md`, `README.md`, and the issue-code catalogue in `src/lib/issue-codes.ts`, the intended end state additionally includes: supplier-statement reconciliation with discrepancy memos, a month-close checklist with lock, a missing-items tracker, an accounting export with reverse reconciliation against **Foodics** (the café's POS/accounting system), email + WhatsApp alerting, and an in-app "read the whole Drive and refresh" action. **None of those five are built.**

---

## 2. CURRENT PROJECT STATUS

### `[WORKING]` — implemented, exercised against real data

| Area | Evidence |
|---|---|
| Google OAuth login with allowlist + 3-role matrix | `src/auth.ts`, `src/lib/permissions.ts`, 9 passing tests, production login confirmed working |
| Document extraction via Gemini (`gemini-flash-latest`) | `src/lib/extraction/provider-gemini.ts`; `/api/health` reports `provider: gemini, keyPresent: true` |
| Pure extraction pipeline (naming, folder, findings) | `src/lib/extraction/pipeline.ts`, 21 tests |
| Filename build/parse for the existing archive | `src/lib/naming.ts`, 26 tests; parsed 153 of 161 real archive filenames |
| Drive upload with collision-safe naming, never overwrite | `src/lib/drive.ts`, `src/app/api/archive/route.ts` |
| Money as integer halalas | `src/lib/money.ts`, 5 tests |
| Saudi VAT validation rules | `src/lib/validation.ts`, 12 tests |
| Supplier matching | `src/lib/supplier-match.ts`, 10 tests |
| Bank statement parsing (SNB format) | `src/lib/bank/parse.ts`; parsed 1,428 real rows with 0 warnings |
| Bank ↔ invoice matching + duplicate detection | `src/lib/bank/match.ts`, 21 tests; 1,428 tx rows and 47 allocations in the live DB |
| Append-only audit log | `drizzle/sql/001_audit_log_immutable.sql`; all 3 triggers verified present in production DB |
| 7 pages render; all return HTTP 307→/login when logged out, 200 for `/login` | live curl |
| Health endpoint | `GET /api/health` returns `{"healthy":true,...}` |
| CI (typecheck + lint + test + build) | `.github/workflows/ci.yml` |

### `[PARTIAL]` — implemented but unreliable, incomplete, or built on empty data

| Area | Why it is only partial |
|---|---|
| **Consumption analysis (`/analysis`)** | The page works, but `invoice_lines` contains **1 row** in the entire database. The archive migration only recorded invoice *totals* parsed from filenames, never line items. The page is technically functional and effectively empty. |
| **Price-change tracking (`/audit`)** | Same root cause: needs line items; there is 1 line row. |
| **VAT-at-risk KPI** | 122 of 123 invoices have `vat_minor = 0` because migration could not know the VAT split. `vatAtRisk()` only counts rows with `vatMinor > 0`, so the dashboard reports **0 SAR at risk** — which reads as "nothing at risk" when the truth is "VAT is unknown". Actively misleading. |
| **Invoice tax validity** | Exactly **1 of 123** invoices has `is_tax_valid = true`. Migrated invoices default to `false`. The payment-run therefore holds back essentially every invoice. |
| **Payment run (`/payments`)** | Logic and CSV export are correct and tested (12 tests), but with `is_tax_valid` false almost everywhere, `ready` will be empty in practice. |
| **Bank import** | Works, but re-importing the same statement inserts a second `bank_imports` row and 1,428 more `bank_transactions` rows. There is no idempotency key on the import or on transactions. |
| **`mark-paid`** | Works, but fabricates the payment date: it sets `paidAt = invoice.invoiceDate`, not the real transfer date. It is labelled in the audit log as owner assertion, which is honest, but the dates in `payments` are fiction. |
| **Duplicate-file detection** | `documents.sha256` is `NULL` for **153 of 154** rows (all migrated docs). Re-uploading a file that already exists in the archive will not be caught by hash. |
| **Trial mode (`AUTH_BYPASS`)** | Implemented with a loud banner; currently `false` in production, but the switch exists as a production environment variable. |

### `[PLANNED]` — designed, not built

- Supplier statement reconciliation. `statements` table has 11 rows; `statement_lines` has **0**; no parser, no UI, no discrepancy memo.
- Month close. `month_closes` table exists and is referenced **nowhere** outside the schema file.
- Alerts / notifications (email or scheduled WhatsApp). Only an ad-hoc `wa.me` deep link on `/payments`.
- Accounting export + Foodics reverse reconciliation.
- Missing-items tracker.
- Issues UI. `issues` rows are written by `/api/archive` only, and **0 rows exist**; no page reads the table.
- In-app "re-read Drive" action. Only the CLI `npm run drive:migrate` exists.
- Firebase App Hosting deployment. `apphosting.yaml` is complete but unused; the app runs on Vercel.
- Supplier CRUD. Suppliers can only be created by editing `src/lib/suppliers-seed.ts` and running `npm run db:seed`.

### `[BROKEN]` / defects

1. **Server does not re-validate what the client sends.** `/api/archive` accepts `isTaxValid`, `inputVatEligible`, `isFixedAsset`, `subtotal`, `vat`, `total`, and `findings` straight from the browser and writes them. The blocker gate reads `body.findings` — a client that sends `findings: []` bypasses every blocking rule. `validateInvoice()` is never called on the archive path.
2. **Financial amounts leak to `PURCHASING`.** `/api/analyze` requires only `document:upload`, which `PURCHASING` has, and returns full `subtotalMinor` / `vatMinor` / `totalMinor`. Hiding is client-side (`canSeeAmounts` prop) only.
3. **Silent invoice loss.** In `/api/archive`, if `parseRiyals(body.total)` returns `null` the document is archived to Drive and inserted into `documents`, but **no `invoices` row is created and no error is returned**. The user sees "uploaded successfully".
4. **`TaxInvoice` is not a recognised filename token.** `TYPE_TOKENS` in `src/lib/naming.ts` lacks `taxinvoice`, so `2026-08-18_SardTrading_TaxInvoice_124001345_SAR11600.00.pdf` — a real 11,600 SAR invoice — failed migration and is not in the database.
5. **Subtotal is not editable and goes stale.** The uploader lets the user correct `total` and `vat` but not `subtotal`; `subtotal` is sent from the original extraction. Correcting a total therefore stores an arithmetically inconsistent invoice.
6. **Carry-forward filing rule is dead code.** `resolveInvoiceFiling()` implements the "unpaid invoice arriving after the supplier statement rolls to next month" rule and is tested, but `pipeline.ts` calls `monthOf(date)` directly. The rule is never applied.
7. **Audit action labels are wrong.** `mark-paid` and `bank-import` both write `action: "DOCUMENT_ARCHIVED"`. There is no `PAYMENT_*` action in the `AuditAction` union. The audit trail's action column is not trustworthy for filtering.
8. **`duplicatePaymentCount` is hardcoded to `0`** in `/dashboard` (`src/app/dashboard/page.tsx`), even though `findDuplicatePayments()` exists and found 10 groups during bank import.
9. **Invoice-combination matching is capped at 14 invoices** (`pool.slice(0, 14)` in `findInvoiceCombination`). A supplier with more open invoices silently loses matches with no warning.

### `[UNKNOWN]`

- Whether the Vercel **Preview** environment's `DATABASE_URL` points at the same Neon database as Production. Preview-scoped secrets exist for `DATABASE_URL` and `AUTH_SECRET`; values are hidden. If they are the same database, preview deployments write to production data.
- Whether the Google OAuth consent screen is in Testing or Production mode (affects refresh-token lifetime — Testing-mode refresh tokens expire after 7 days).
- Neon plan limits, backup/PITR retention.
- Real-world extraction accuracy. No accuracy benchmark has been run; extraction has been exercised on a handful of documents interactively.

### Tested vs not tested

**Tested (215 unit tests, 15 files, all passing, 446 ms):**
`analytics 26 · naming 26 · bank/match 21 · extraction/pipeline 21 · insights 17 · extraction/provider 17 · items 15 · payment-run 12 · validation 12 · filing 10 · supplier-match 10 · permissions 9 · suppliers-seed 9 · audit 5 · money 5`

**Not tested at all:** every API route, every page, the database layer, `src/lib/drive.ts`, `src/lib/bank/parse.ts`, `src/auth.ts`, `src/lib/session.ts`, `src/middleware.ts`, and all React components. There are no integration, E2E, or contract tests.

### Blocking production readiness

1. Client-trusted financial flags and findings (defect #1) — an integrity hole in the core write path.
2. `invoice_lines` is empty, so half the promised analytics have nothing to analyse.
3. `vat_minor = 0` on 122/123 invoices makes the VAT KPIs wrong rather than merely absent.
4. Silent failure path in archive (defect #3).
5. No rate limiting on any endpoint; each `/api/analyze` call spends a Gemini quota unit.
6. Secrets (`GEMINI_API_KEY`, `GOOGLE_CLIENT_SECRET`) were pasted into a chat transcript and live in a local `.env`; they should be rotated.

---

## 3. SYSTEM ARCHITECTURE

### Components

| Layer | Technology | Notes |
|---|---|---|
| Frontend | Next.js 16.3.4 App Router, React 19.2.8, Tailwind CSS v4 | Server Components for all pages; two client components (`uploader.tsx`, `bank-import.tsx`). RTL, `lang="ar"`. Local Thmanyah fonts via `next/font/local`. |
| Backend | Next.js Route Handlers, `runtime = "nodejs"` | 7 routes. No separate server process. |
| Database | Neon Postgres, accessed via Drizzle ORM 0.45.2 over `pg` 8.23 | Pooled endpoint `ep-wandering-bread-ael4pgk9-pooler.c-2.us-east-2.aws.neon.tech`. |
| Auth | Auth.js v5 (`next-auth@5.0.0-beta.32`) + `@auth/drizzle-adapter` | Google provider, **database** session strategy, sessions in `sessions` table. |
| File storage | Google Drive (the user's own Drive) | The app stores **no file bytes**; only `drive_file_id` + metadata. |
| AI | Google Gemini REST (`v1beta/models/gemini-flash-latest:generateContent`) | Swappable via `EXTRACTION_PROVIDER`. Alternatives: Anthropic Claude SDK, local Ollama. |
| Spreadsheets | `xlsx` 0.18.5 | Bank statement parsing only. |
| Hosting | Vercel (Production, `tph4/tph-invoicing`) | 13 Ready production deployments; latest 23 min before this report. |
| CI | GitHub Actions | typecheck → lint → test → build with dummy env. |

**Background jobs: none. Queues: none. Webhooks: none. Cron: none.** Every operation is synchronous inside an HTTP request. Long jobs (reading the whole Drive) exist only as local CLI scripts run with `tsx`.

### Data flow

```
                    ┌───────────────────────────┐
   Browser ────────►│  Next.js on Vercel        │
   (iPhone/iPad/    │  ─ Server Components      │
    laptop, RTL)    │  ─ Route Handlers         │
                    └───┬───────────┬───────┬───┘
                        │           │       │
        session cookie  │           │       │  base64 file
        ┌───────────────┘           │       └──────────────┐
        ▼                           ▼                      ▼
 ┌──────────────┐        ┌──────────────────┐     ┌──────────────────┐
 │ Neon Postgres│        │ Gemini REST API  │     │ Google Drive API │
 │ 17 tables    │        │ generateContent  │     │ files.list       │
 │ triggers on  │        │ responseSchema   │     │ files.create     │
 │ audit_logs   │        │ temperature 0    │     │ (no delete/move) │
 └──────┬───────┘        └──────────────────┘     └────────▲─────────┘
        │                                                   │
        │  accounts.refresh_token (Google, offline)          │
        └───────────────────────────────────────────────────┘

 Local-only (CLI, tsx, not deployed):
   drive-inventory · migrate-archive · seed-suppliers · try-* · diagnose-drive
```

### How components communicate

- Browser → backend: `fetch` with `FormData` (analyze, bank-import) or JSON (archive, mark-paid). Session via HTTP-only cookie.
- Backend → Gemini: single `POST` with the file inlined as base64 in `inline_data`, plus `responseSchema`.
- Backend → Drive: `googleapis` client authenticated with **the signed-in user's own** `refresh_token`, read from `accounts.refresh_token`. This is deliberate — Drive activity shows the real person, not a shared service account.
- Backend → Postgres: one shared `pg.Pool`, `max: 1` when `process.env.VERCEL` is set, 10 locally; `connectionTimeoutMillis: 10s`, `statement_timeout: 30s`, `query_timeout: 30s`.

---

## 4. COMPLETE USER WORKFLOW

### A. Logging in

1. `middleware.ts` intercepts everything except `/login`, `/api/auth`, `/api/health`, static assets. It checks only for the *presence* of `authjs.session-token` / `__Secure-authjs.session-token`. Missing → redirect to `/login?from=<path>` for pages, `401 JSON` for `/api/*`.
2. `/login` renders a server-action form calling `signIn("google")`.
3. Google consent requests `openid email profile https://www.googleapis.com/auth/drive`, with `access_type=offline` and `prompt=consent` (both required to obtain a refresh token).
4. `signIn` callback: lowercase the email, reject unless it is in `ALLOWED_EMAILS`; if a `users` row exists, reject when `is_active = false`.
5. `DrizzleAdapter` creates/links `users`, `accounts` (storing `refresh_token`), and `sessions`.
6. `createUser` event sets the role from the allowlist, **once**. Thereafter the role lives in the database.
7. `session` callback re-reads `role` from the DB on every request.
8. Each page calls `currentUser()`; each API route calls `requireUser(capability)`.

If `AUTH_BYPASS=true`, all of the above is skipped and a synthetic `OWNER` (`trial-user` / `trial@local`) is returned, with a persistent warning banner. Currently `false` in production.

### B/C. Uploading a document or a purchase invoice (same path)

1. Client reads the file into an `ArrayBuffer`, base64-encodes it (32 KB chunks), and keeps the bytes in React state — so the exact original bytes are uploaded later, not a re-encoded copy.
2. `POST /api/analyze` with `multipart/form-data`.
3. Server: `requireUser("document:upload")` → validate non-empty, ≤ 25 MB, MIME in {`application/pdf`, `image/jpeg`, `image/png`, `image/gif`, `image/webp`} → SHA-256 the bytes.
4. Load active suppliers + their aliases from Postgres.
5. `extractDocument()` → Gemini. Returns validated JSON or a typed failure (`502` to the client).
6. `matchSupplier()` — VAT (confidence 1.0) → alias (0.95) → exact normalized name (0.90) → fuzzy (auto-accept only if score ≥ 0.85 **and** ≥ 0.2 clear of the runner-up); otherwise candidates are returned for human choice.
7. Look up a `documents` row with the same `sha256`; look up existing invoice numbers for the matched supplier.
8. `runPipeline()` — a pure function — computes: parsed amounts, document kind, validation findings, VAT validity, input-VAT eligibility, fixed-asset flag, low-confidence field list, proposed filename, proposed Drive folder, and `canArchive`.
9. Response returned. **Nothing has been written to Drive or the database yet.**
10. The browser renders an editable card: invoice number, date, total, VAT, and the proposed filename. Low-confidence fields are outlined in amber. Findings render as INFO/WARN/BLOCKER chips.
11. Human presses "أرشِف". `POST /api/archive` with JSON including the base64 bytes.
12. Server: `requireUser("document:upload")` → reject if any supplied finding is `BLOCKER` → re-hash → reject `409` if the hash already exists → read the user's Google refresh token (`428` if absent).
13. Drive: `findOrCreateFolder(year → YYYY-MM)` → `findOrCreateFolder(month → supplier folder)` → `existingNamesIn()` → `resolveNameCollision()` (appends ` (2)`, ` (3)`, … — never overwrites) → `files.create` with a `Readable` stream.
14. Postgres, in one transaction: insert `documents` (status `ARCHIVED`, `extraction_json` = the raw model output, kept unmodified forever) → if invoice-like and all of supplier/number/date/total present, insert `invoices` → insert `invoice_lines` (skipping any line with neither unit price nor line total, so a fabricated zero can never corrupt an average) → if `STATEMENT`, insert `statements` → if `RECEIPT`/`CASH_RECEIPT`, insert `payments` → insert one `issues` row per finding.
15. `diffCorrections()` compares raw extraction against the confirmed values; `recordAudit()` writes an immutable row containing both.
16. Response returns the final name, `driveFileId`, `webViewLink`, and which fields the human corrected. The card is removed from the screen, moved into a session list, and `router.refresh()` re-runs the server components.

Timeout: the client aborts after 120 s with an explicit Arabic message rather than hanging.

### D. Uploading a sales / POS report

**Not supported.** There is no POS or sales ingestion anywhere in the codebase. The archive contains outgoing sales invoices (`Sales - Sabea Jar`) and the naming parser recognises a `SALES_INVOICE` kind, but migration maps it to `documents.kind = UNKNOWN` and deliberately excludes it from purchases. Foodics is referenced in planning documents only.

### E/F. Uploading an image or a PDF

Identical path (B/C). The only difference is inside the provider: Claude sends a `document` content block for PDFs and an `image` block otherwise; Gemini sends `inline_data` for both; Ollama **rejects PDFs outright** with an explanatory message. Cash receipts additionally get their filename extension coerced from `pdf` to `jpg` in the pipeline.

### G. Uploading an Excel/CSV file

Only through `/bank` → `POST /api/bank-import`, and only for **bank statements**. Never touches Drive, never calls the LLM.

1. `requireUser("bank:view")`; ≤ 15 MB.
2. `parseBankStatement()` — `XLSX.read` → first sheet → header row found by *name* within the first 40 rows (Arabic or English), account number sniffed from any ≥10-digit run above the header.
3. Each row: date `DD/MM/YYYY` (first line only, so a trailing time line is tolerated) or ISO; amount with Arabic-Indic digits, Arabic thousands `٬` and decimal `٫`, parentheses or leading minus meaning debit; balance; a ≥6-digit reference extracted from the description.
4. Build a supplier alias index (Arabic name, English name, Drive folder name, every alias).
5. Load open invoices (`total_minor − Σ allocations > 0`).
6. `matchBankTransactions()`: credits and operational patterns (POS, fees, VAT-on-fee, monthly charges) → `INTERNAL`; otherwise `findSupplierInText()` by distinctive tokens; then `findInvoiceCombination()` tries single invoice → whole group → 2-combination → 3-combination, ±1.00 SAR tolerance; an invoice already claimed by an earlier transfer cannot be claimed again.
7. `findDuplicatePayments()` groups debits by (date, amount, first 30 chars of normalized description).
8. **Without `apply=true`:** returns a summary, up to 40 sample matches, the 15 largest unknown transactions — and writes nothing.
9. **With `apply=true`:** insert `bank_imports`, then per transaction insert `bank_transactions`, and for matched ones a `payments` row plus `payment_allocations` (`onConflictDoNothing`), then one audit row.

Live result on the owner's real statement: bank الأهلي (SNB), account `12600000942005`, 2026-05-08 → 2026-09-01, 1,428 rows, **0 parse warnings**, 1,279 operational, 149 candidate payments, 47 invoices matched, 28 supplier-recognised-but-unmatched, 100 unknown, 10 suspected duplicate groups.

### H. Requesting an analysis

There is no "analyse" button and no analysis job. `/dashboard`, `/audit`, `/analysis`, `/suppliers`, `/payments` are `dynamic = "force-dynamic"` Server Components that query Postgres on every request and compute everything in TypeScript in-process. No caching, no materialised views, no LLM involvement.

### I. Opening a previously archived document

**Only within the current browser session.** The uploader keeps a session-local list with the Drive `webViewLink`. After a refresh, that list is gone. There is **no documents list page, no search, and no link from any table row back to the Drive file** — even though `documents.drive_file_id` is stored for all 154 rows.

---

## 5. GOOGLE DRIVE

### Authentication

Per-user OAuth 2.0. Scope `https://www.googleapis.com/auth/drive` (full), requested at login with `access_type=offline` + `prompt=consent`. The refresh token is stored in `accounts.refresh_token` and read on demand:

```ts
const [row] = await db.select({ token: accounts.refresh_token })
  .from(accounts)
  .where(and(eq(accounts.userId, userId), eq(accounts.provider, "google")));
```

Uploads therefore appear in Drive activity as the actual person. If no token exists the API returns **428** with instructions to sign out and back in. CLI scripts fall back to `GOOGLE_DRIVE_REFRESH_TOKEN`, or to the first stored Google account in the database.

`src/lib/drive.ts` also exports `DRIVE_SCOPE_READONLY`; `npm run drive:auth` defaults to read-only and requires `--write` to escalate.

### Folder structure

```
ACCOUNTS/                      (DRIVE_ACCOUNTS_FOLDER_ID)
├── 2026/                      (DRIVE_YEAR_2026_FOLDER_ID)
│   ├── 2026-05/ … 2026-09/
│   │   ├── <Supplier folder name, verbatim, e.g. "BeCof (بيكوف)">
│   │   ├── _إيصالات السداد           (payment receipts)
│   │   ├── _نقدي - Cash receipts
│   │   ├── _مرافق وحكومي - Utilities & Gov
│   │   └── _أخرى - Other suppliers
└── 2027/                      (DRIVE_YEAR_2027_FOLDER_ID)
```

Folder IDs come from environment variables only — never hardcoded. Only 2026 and 2027 are mapped; **2028 will fail with an explicit 400** (`config/drive.ts` has a fixed two-year map).

Note the deliberate split: `suppliers.drive_folder_name` (`"Sard Trading (سرد - معدات)"`) is distinct from `suppliers.slug` (`"SardTrading"`), because Drive folder names and filename slugs genuinely differ in this archive.

### Filename conventions

```
Invoice   : YYYY-MM-DD_<Slug>_Invoice_<InvoiceNo>_SAR<Amount>.pdf
Statement : YYYY-MM-DD_<Slug>_Statement_SAR<Amount>.pdf
Receipt   : YYYY-MM-DD_Receipt_<Slug>[-<Beneficiary>]_SAR<Amount>.pdf
Cash      : YYYY-MM-DD_Cash_<description>_SAR<Amount>.jpg
```

`SAR<Amount>` must carry exactly two decimals; `SAR410` is **rejected** rather than silently treated as a description, so a typo in an amount cannot pass as text. `splitSlugAndBeneficiary()` resolves `Loreva-MaqamAlThiqa` by longest-known-slug prefix, which is what keeps `PURE-Oska` from being split at its own hyphen.

### Folder selection / creation

`findOrCreateFolder(drive, parentId, name)` — list by exact name inside the parent, create if absent. Called twice per upload (month, then supplier folder). Single-quotes in names are escaped for the Drive query.

### Upload

`drive.files.create` with `media.body` = a `Readable` from the buffer, `fields: "id, name, webViewLink"`, `supportsAllDrives: true`. `drive_file_id`, `drive_folder_id`, `file_name`, `mime_type`, `size_bytes`, `sha256` are all persisted.

### Renaming / moving / archiving

**The app renames the file it is uploading, and nothing else.** `src/lib/drive.ts` contains **no delete, no move, and no update-metadata function** — by design, matching the owner's standing instruction that the archive must never be touched. Existing files are never renamed retroactively.

### Failure behaviour

Any Drive exception during the upload block returns **502** with the message, before any database write. The transaction has not started, so there is no orphan row. The reverse failure — Drive succeeded, transaction failed — leaves an **orphan file in Drive with no database row**. There is no compensating delete (deliberately) and no reconciliation job (a gap).

### Same file uploaded twice

- **Content-identical:** SHA-256 lookup returns **409** "already uploaded as `<name>`" *provided the earlier row has a hash*. 153 of 154 rows have `sha256 = NULL`, so this guard does not cover the migrated archive.
- **Same name, different content:** `resolveNameCollision()` appends ` (2)`. The UI explicitly says "a copy number was added — no existing file was replaced".
- **Same supplier + invoice number:** `invoice_supplier_number_uniq` rejects it at the database level, and the pipeline raises a `DUPLICATE_INVOICE` BLOCKER earlier.

### If the user manually renames / deletes / moves a file in Drive

Nothing happens, and nothing notices. `drive_file_id` survives rename and move, so a *link* would still work, but the stored `file_name` and `drive_folder_id` go stale. A deleted (trashed) file leaves a dangling reference; the app never re-reads Drive after archiving. **There is no Drive→DB reconciliation of any kind.** This is the single largest synchronisation gap in the system.

---

## 6. DOCUMENT / INVOICE PROCESSING

### Actual pipeline

```
File (browser)
  → base64 kept client-side
  → POST /api/analyze
      auth (document:upload)
      size ≤ 25 MB · non-empty · MIME allowlist          ← client-declared MIME, not sniffed
      SHA-256
      load suppliers + aliases from Postgres
      Gemini generateContent (inline base64, responseSchema, temperature 0)
      zod safeParse of the model's JSON
      matchSupplier(VAT → ALIAS → NAME → FUZZY)
      SHA lookup + existing invoice numbers lookup
      runPipeline() [pure]:
          parseRiyals on subtotal/vat/total
          validateInvoice() → findings, isTaxValid, inputVatEligible, isFixedAsset
          duplicate-file / duplicate-invoice findings
          filename + folder proposal
          canArchive = has name && has folder && no BLOCKER
  → human review & edit in browser
  → POST /api/archive
      auth · BLOCKER gate (on CLIENT-supplied findings) · SHA 409 · Drive token 428
      Drive: folders → collision-safe name → upload
      Postgres transaction: documents → invoices → invoice_lines → statements/payments → issues
      audit log with before/after and the diff of human corrections
```

### Specifics

| Item | Value |
|---|---|
| Supported types | `application/pdf`, `image/jpeg`, `image/png`, `image/gif`, `image/webp` (Gemini additionally accepts `webp/heic/heif`) |
| Max size | 25 MB (`/api/analyze`), 15 MB (`/api/bank-import`). No explicit cap on `/api/archive` beyond Vercel's body limit. |
| OCR technology | **None.** No Tesseract, no OCR service. The vision LLM reads the document directly. This was a deliberate choice — extracting text from Arabic PDFs produced reversed glyphs. |
| Model in use | `gemini-flash-latest` (Google Gemini free tier) |
| Structured output | Enforced. Gemini `responseSchema` (hand-written OpenAPI subset) + `zod.safeParse` on the response. Claude uses `zodOutputFormat`. Ollama uses `z.toJSONSchema`. |
| Temperature | `0` for Gemini and Ollama. Not set for Claude (`messages.parse` default). |
| Extracted fields | `documentKind`, `supplierNameAr`, `supplierNameEn`, `sellerVatNumber`, `sellerCrNumber`, `buyerNameAr`, `buyerVatNumber`, `invoiceNumber`, `invoiceDate`, `subtotalAmount`, `vatAmount`, `totalAmount`, `beneficiaryName`, `lines[]{description,quantity,unitPrice,lineTotal}`, `confidence{6 groups}`, `notes` |
| Amounts as strings | Yes, deliberately — JSON numbers would lose the two-decimal contract. Converted to integer halalas by `parseRiyals()` in TypeScript. |
| Confidence handling | Per-field-group 0–1 from the model. Below `0.8` (configurable) → field listed in `lowConfidenceFields`, a `LOW_CONFIDENCE_FIELD` WARN finding is raised, and the input is outlined amber in the UI. Confidence never blocks. |
| Validation | `validateInvoice()` — see §8 |
| Duplicate detection | SHA-256 on content; `(supplier_id, invoice_number)` unique index; filename collision suffixing |
| Retry | Gemini only: `MAX_ATTEMPTS = 4`, retry on `{429,500,502,503,504}` and on network errors, exponential backoff `GEMINI_RETRY_BASE_MS × 2^(n−1)` (default 1000 ms). Distinct Arabic messages for 429 (quota), 503 (overloaded), 404 (model unavailable for this key). No retry for Claude or Ollama. |
| Human review | **Mandatory.** Nothing reaches Drive or the database without an explicit click, and every field the human changed is diffed into the audit log. |

### Error handling

Every provider returns a discriminated union `{ok:true,…} | {ok:false, reason, provider}` — no thrown exceptions cross the provider boundary. Route handlers map: unauthenticated → 401, forbidden → 403, bad input → 400, extraction failure → 502, duplicate → 409, missing Drive token → 428, Drive failure → 502.

---

## 7. DATABASE

PostgreSQL on Neon. Drizzle ORM with `casing: "snake_case"`. IDs are `text` primary keys holding a `randomUUID()` generated in Node (`src/lib/id.ts`). All money is `integer` halalas. All accounting months are `text` `YYYY-MM`.

**Schema is applied with `drizzle-kit push`. `drizzle/` contains only `sql/001_audit_log_immutable.sql` — there are no generated migration files and therefore no migration history, no rollback, and no reproducible schema evolution.**

### Live row counts (production, verified)

| Table | Rows | | Table | Rows |
|---|---:|---|---|---:|
| `users` | 1 | | `payments` | 27 |
| `accounts` | 1 | | `payment_allocations` | 47 |
| `sessions` | 1 | | `bank_imports` | 1 |
| `suppliers` | 24 | | `bank_transactions` | 1,428 |
| `supplier_aliases` | 86 | | `issues` | **0** |
| `documents` | 154 | | `month_closes` | **0** |
| `invoices` | 123 | | `statement_lines` | **0** |
| `invoice_lines` | **1** | | `audit_logs` | 2 |
| `statements` | 11 | | `verification_tokens` | 0 |

`invoices`: Σ `total_minor` = **11,815,841 halalas = 118,158.41 SAR**; `is_tax_valid = true` on **1**; `posted_to_accounting = true` on **0**.
`documents` by kind: TAX_INVOICE 130, STATEMENT 14, RECEIPT 6, PROFORMA 2, QUOTATION 1, UNKNOWN 1. All 154 have `status = ARCHIVED`. 153 have `sha256 IS NULL`.
By month: 2026-05 → 15 inv / 24,837.15 · 2026-06 → 28 / 26,185.93 · 2026-07 → 30 / 37,993.51 · 2026-08 → 43 / 25,906.12 · 2026-09 → 7 / 3,235.70.

### Table reference

**`users`** — identity. PK `id text`. `email text NOT NULL UNIQUE`, `name`, `email_verified timestamptz`, `image`, `role role_enum NOT NULL DEFAULT 'PURCHASING'`, `is_active bool NOT NULL DEFAULT true`, `created_at`. Enum `role`: `OWNER | ACCOUNTANT | PURCHASING`.

**`accounts`** — Auth.js OAuth accounts; also the store for the Google `refresh_token` used for Drive. Composite PK `(provider, provider_account_id)`. FK `user_id → users.id ON DELETE CASCADE`.

**`sessions`** — PK `session_token`, FK `user_id → users.id CASCADE`, `expires`.

**`verification_tokens`** — Auth.js requirement; unused (email provider not configured). Composite PK `(identifier, token)`.

**`suppliers`** — the registry. PK `id`. `slug text UNIQUE` (filename token), `drive_folder_name text NOT NULL` (Drive folder, verbatim, often different), `name_ar NOT NULL`, `name_en`, `vat_number text UNIQUE`, `cr_number`, `category supplier_category DEFAULT 'OTHER'` (`COFFEE|FOOD|PACKAGING|EQUIPMENT|WATER|UTILITIES|OTHER`), `billing_cycle` (`PER_DELIVERY|MONTHLY_STATEMENT`), `payment_terms`, `issues_invoices bool DEFAULT true` (false = supplier issues no tax invoice at all), `contract_on_file bool DEFAULT false`, `contract_drive_file_id`, `balance_alert_minor int`, `is_active`, timestamps. Index `suppliers_active_idx(is_active)`.

**`supplier_aliases`** — every other name a supplier is known by. FK `supplier_id CASCADE`. `value`, `normalized` (for matching), `kind alias_kind` (`BANK_BENEFICIARY|NAME_VARIANT|VAT|FOLDER`), `source alias_source` (`MIGRATION|MANUAL|LEARNED`), `confidence double DEFAULT 1`. Unique `(supplier_id, normalized, kind)`; index on `normalized`. **This table is what makes bank matching possible** — e.g. `"شركة أنس غالب حمزة خاشقجي التجارية المحدودة"` → Ganache.

**`documents`** — one row per archived file, the hub of the model. `drive_file_id text UNIQUE`, `drive_folder_id`, `file_name NOT NULL`, `mime_type NOT NULL`, `size_bytes`, `sha256`, `kind document_kind DEFAULT 'UNKNOWN'` (10 values), `status document_status DEFAULT 'PENDING'` (`PENDING|EXTRACTED|NEEDS_REVIEW|ARCHIVED|REJECTED`), `period_month`, `supplier_id → suppliers.id`, `raw_text`, `text_source`, `extraction_json jsonb` (raw model output, never edited), `extraction_model`, `field_confidence jsonb`, `uploaded_by_id → users.id`, timestamps. Indexes on `sha256`, `(period_month, supplier_id)`, `status`. — `raw_text`, `text_source`, and `field_confidence` are **never written by any code path**.

**`invoices`** — `document_id UNIQUE NOT NULL → documents.id CASCADE` (strict 1:1), `supplier_id NOT NULL`, `invoice_number NOT NULL`, `invoice_date timestamptz NOT NULL`, `period_month NOT NULL`, `subtotal_minor / vat_minor / total_minor int NOT NULL`, `seller_vat`, `buyer_vat`, `is_tax_valid`, `input_vat_eligible`, `is_fixed_asset`, `posted_to_accounting`, `posted_at`, `posting_ref`, `carried_forward_from`. Unique `(supplier_id, invoice_number)`; indexes on `period_month`, `invoice_date`, `posted_to_accounting`.

**`invoice_lines`** — FK `invoice_id CASCADE`. `description`, `normalized_description` (drives all item grouping), `qty numeric(12,3)`, `unit_price_minor`, `line_total_minor`, `vat_rate numeric(5,4) DEFAULT 0.15`, plus **denormalized** `invoice_date` and `supplier_id` so price history needs no join. Indexes on `invoice_id`, `normalized_description`, `(normalized_description, invoice_date)`.

**`statements`** — `document_id UNIQUE`, `supplier_id`, `period_start`, `period_end`, `opening_balance_minor`, `closing_balance_minor`. Index `(supplier_id, period_end)`.

**`statement_lines`** — designed for statement reconciliation: `statement_id CASCADE`, `date`, `ref`, `description`, `debit_minor`, `credit_minor`, `matched_invoice_id → invoices.id`, `match_status` (`UNMATCHED|MATCHED|PARTIAL|DISPUTED|IGNORED`). **Zero rows; no code writes it.**

**`payments`** — `document_id UNIQUE` (nullable — bank-derived payments have no document), `supplier_id` (nullable), `paid_at NOT NULL`, `amount_minor NOT NULL`, `method` (`BANK_TRANSFER|CASH|EMPLOYEE_ADVANCE`), `beneficiary_name_raw`, `applies_to_month`. Indexes `(supplier_id, paid_at)`, `applies_to_month`.

**`payment_allocations`** — the join that makes an invoice "paid". `payment_id CASCADE`, `invoice_id CASCADE`, `amount_minor`. Unique `(payment_id, invoice_id)`.

**`bank_imports`** — `file_name`, `bank`, `row_count`, `imported_by_id`, `imported_at`.

**`bank_transactions`** — `bank_import_id CASCADE`, `value_date`, `description`, `beneficiary_raw`, `amount_minor`, `direction` (`DEBIT|CREDIT`), `ref`, `matched_payment_id → payments.id`, `match_status`. Indexes on `value_date`, `match_status`.

**`issues`** — `code`, `severity` (`INFO|WARN|BLOCKER`), `status` (`OPEN|RESOLVED|WAIVED`), **polymorphic** `entity_type text` + `entity_id text` (no FK), `message`, `resolved_by_id`, `resolved_at`, `waiver_reason`. Indexes `(status, severity)`, `(entity_type, entity_id)`, `code`.

**`month_closes`** — `month text UNIQUE`, `status` (`OPEN|IN_REVIEW|CLOSED`), `checklist jsonb`, `closed_by_id`, `closed_at`. **Zero rows; referenced nowhere outside the schema.**

**`audit_logs`** — `actor_id → users.id`, `action`, `entity_type`, `entity_id`, `before jsonb`, `after jsonb`, `at`. Indexes `(entity_type, entity_id)`, `at`. **Protected by three database triggers** (`audit_logs_no_update`, `audit_logs_no_delete`, `audit_logs_no_truncate`), all verified present in production. The TRUNCATE trigger is statement-level because row triggers do not fire on TRUNCATE — a hole found and closed during development.

### Relationships

```
users 1─┬─n accounts (holds Google refresh_token)
        ├─n sessions
        └─n documents (uploaded_by)

suppliers 1─┬─n supplier_aliases
            ├─n documents
            ├─n invoices ─1:1─ documents
            │              └─n invoice_lines
            ├─n statements ─1:1─ documents
            │              └─n statement_lines (empty)
            └─n payments ──1:0..1─ documents

payments n──n invoices  (via payment_allocations)
bank_transactions n──1 bank_imports,  0..1─► payments
issues ──polymorphic──► documents | invoices | payments | suppliers
audit_logs ──polymorphic──► anything
```

### Design problems and missing entities

1. **No `products` / `items` entity.** Item identity is a computed `normalized_description` string on each line. Renaming rules change grouping retroactively and there is no way to merge two spellings by hand, add a canonical name, a unit, a pack size, or a category.
2. **No inventory entity at all.** No stock levels, no counts, no variance, no wastage. `/analysis` explicitly tells the user the system does not know their stock.
3. **No sales / POS entity.** Therefore no COGS, no gross margin, no food-cost ratio — the numbers a café most needs.
4. **`issues` is polymorphic with no foreign keys** — orphan rows are possible and there is no referential integrity.
5. **No `bank_transactions` natural key** — nothing prevents importing the same statement twice.
6. **`invoices.subtotal_minor` and `vat_minor` are `NOT NULL` with no check constraint** that `subtotal + vat = total`. 122 rows currently hold `0, 0, <total>`.
7. **No `CHECK` constraints anywhere** — no non-negative amounts, no `period_month ~ '^\d{4}-\d{2}$'`, no enum-backed month.
8. **`documents.sha256` is nullable and un-indexed for uniqueness** — it is a plain index, not a unique one, so nothing at the database level prevents duplicate content.
9. **No soft-delete or versioning** on invoices; a correction has no home.
10. **No migrations directory** — schema drift between environments cannot be detected or replayed.

---

## 8. FINANCIAL / BUSINESS LOGIC

**Every number in this system is computed by deterministic TypeScript. The LLM never calculates anything — it only transcribes strings, which are then parsed to integers by `parseRiyals()`.** The system prompt explicitly forbids computing: *"copy the numbers literally; do not compute, correct, or infer a missing amount; if unclear leave it empty and lower the confidence."* This is the single best architectural decision in the project and should not be changed.

### Money representation

`src/lib/money.ts` — `parseRiyals(string) → integer halalas | null`. Handles Arabic-Indic (`٠-٩`), Extended Arabic-Indic (`۰-۹`), Arabic thousands separator `٬`, Arabic decimal `٫`, Latin `,`, whitespace, and leading minus. Rejects anything not matching `^-?\d+(\.\d{1,2})?$`. `formatRiyals` always emits two decimals. `HALALAS_PER_RIYAL = 100`.

### Implemented calculations

| Metric | Formula | Source | Where | By |
|---|---|---|---|---|
| Payment state | `remaining = total_minor − Σ allocations`; `≤0 alloc → UNPAID`, `remaining > 1 → PARTIAL`, `remaining < −1 → OVERPAID`, else `PAID` | `invoices`, `payment_allocations` | `analytics.paymentStatus` | code |
| Outstanding balance | `Σ max(0, remaining)` over unpaid | same | `/dashboard`, `/audit` | code |
| Supplier balance | `Σ invoices.total_minor − Σ allocations` per supplier | SQL subqueries | `/suppliers` | SQL + code |
| Aging buckets | days = `floor((asOf − invoice_date)/86 400 000)`; `<30 / <60 / <90 / <120 / older` | `invoices` | `analytics.buildAging` | code |
| VAT validity | `!isQuotationOrProforma && hasNumber && validSellerVat && buyerVat === companyVat && vat_minor > 0` | extraction | `validation.validateInvoice` | code |
| Saudi VAT number check | 15 digits, starts with `3`, ends with `3` | extraction | `validation.isValidSaudiVat` | code |
| VAT arithmetic check | `subtotal + vat === total` (exact); then `\|round(subtotal × 0.15) − vat\| ≤ 1` halala | extraction | same | code |
| Input-VAT eligible | `= isTaxValid` | — | same | code |
| Fixed-asset flag | `basis = inputVatEligible ? subtotal : total`; `basis > 300 000` halalas (3,000 SAR) | — | same | code |
| VAT at risk | `Σ vat_minor where !input_vat_eligible AND vat_minor > 0` | `invoices` | `analytics.vatAtRisk` | code |
| Recoverable VAT | `Σ vat_minor where input_vat_eligible` | same | same | code |
| Monthly spend | `Σ total_minor GROUP BY period_month` | `invoices` | `analytics.spendByMonth` | code |
| Item total spend | `Σ line_total_minor` per `normalized_description` | `invoice_lines` | `analytics.summarizeItems` | code |
| Item avg unit price | `Σ line_total_minor / Σ quantity` (a spend-weighted average, not a mean of unit prices) | same | same | code |
| Reorder cycle | `(lastDate − firstDate) / 86 400 000 / (uniqueOrderDays − 1)` | same | same | code |
| Price change | latest unit price vs the most recent *different* unit price **within the same supplier** | same | `items.detectPriceChange` | code |
| Annual price impact | `deltaMinor × perYear`, where `perYear = (totalQty/orderCount) × (365/avgDaysBetweenOrders)`, falling back to `totalQuantity` | same | `/audit`, `insights` | code |
| Price gap (multi-supplier) | `dearest.lastUnitPrice − cheapest.lastUnitPrice`, kept if `gap/cheapest ≥ 5%`; `saving = gap × totalQuantity` | same | `analytics.findPriceGaps` | code |
| Spend trend | `(last − prev)/prev`, surfaced at `≥ ±15%` | monthly spend | `insights` | code |
| Payment run | invoices in month with `remaining > 1`; held if `!isTaxValid` or `!inputVatEligible`; grouped by supplier | `invoices` + allocations | `payment-run.buildPaymentRun` | code |

### Deliberately **not** implemented

Revenue, net sales, COGS, gross profit, gross margin, average ticket, sales growth, inventory value, inventory variance, food-cost %. **All of these require sales/POS data that the system does not ingest.** Nothing anywhere fabricates them.

### Where AI is trusted with numbers

Only for **transcription**: the model reads `"410.00"` off a document and returns the string `"410.00"`. Everything downstream is integer arithmetic. The realistic risk is therefore *misreading* (a digit, or subtotal vs total), not *miscalculating*.

Mitigations present: temperature 0, structured schema, per-field confidence, the `subtotal + vat = total` cross-check that flags a misread, mandatory human review, and the raw extraction preserved in `documents.extraction_json` plus the human-correction diff in the audit log.

**Gap:** the cross-check runs at analyze time and its result is passed to `/api/archive` **as client-supplied booleans**. The server never recomputes it. A stale or manipulated client can persist an invoice flagged tax-valid that is not.

### Known limitations

- 122/123 invoices have `subtotal = vat = 0`, so every VAT metric is currently structurally wrong (understated, and reported as if it were zero rather than unknown).
- `averageUnitPriceMinor` mixes units — 1 kg and 1 carton of the same normalized name are summed into one quantity.
- Price comparison is per-supplier by design (comparing across suppliers would show a supplier switch as a "price drop"), which means a genuine cross-supplier increase is invisible in the price-change table (it surfaces only in the price-gap table).
- `annualImpactMinor` extrapolates from a few months of history; on a 4-month archive this is a rough estimate presented with two-decimal precision.
- No currency handling. SAR is assumed everywhere.

---

## 9. AI SYSTEM

### Models and providers

| Provider | Model | Status | Rationale |
|---|---|---|---|
| **Google Gemini** | `gemini-flash-latest` (env `GEMINI_MODEL`) | **ACTIVE** — `EXTRACTION_PROVIDER=gemini` locally and in production | Chosen because the owner explicitly did not want to pay. Free tier. |
| Anthropic Claude | `claude-opus-5` (`EXTRACTION_MODEL` in `extract.ts`) | Implemented, **not in use**. `ANTHROPIC_API_KEY` is empty in `.env` and absent from Vercel. | The accuracy option; paid; data not used for training. |
| Ollama (local) | `qwen2.5vl:7b` (env `OLLAMA_MODEL`) | Implemented, **cannot work in production** — requires a local daemon, and rejects PDFs outright. | The fully-private, fully-free option. |

**Recorded privacy caveat (in the code, `provider-gemini.ts`):** Google's free-tier terms permit using submitted data to improve its products, including human review. The owner accepted this knowingly and temporarily. Switching provider is a one-line environment change.

### Exact API usage (Gemini)

```
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent
Headers: x-goog-api-key: <GEMINI_API_KEY>, content-type: application/json
Body: {
  system_instruction: { parts: [{ text: <Arabic instructions> }] },
  contents: [{ role: "user", parts: [
      { inline_data: { mime_type, data: <base64 of the whole file> } },
      { text: "استخرج حقول هذا المستند وفق المخطط المطلوب." } ]}],
  generationConfig: { temperature: 0,
                      responseMimeType: "application/json",
                      responseSchema: GEMINI_SCHEMA }
}
```

`GEMINI_SCHEMA` is **hand-written**, not generated from zod, because Gemini accepts only a subset of OpenAPI and rejects the `additionalProperties` / `$ref` keys zod emits — automatic generation failed silently. This is a deliberate, documented duplication: `schema.ts` (zod, for validation) and `provider-gemini.ts` (OpenAPI, for the request) must be kept in sync by hand.

### System instructions (`buildInstructions`, shared by all three providers)

Establishes: the assistant is an accountant at `<company>`, a café in Jeddah; the company VAT number; **"we are always the buyer, never the seller"**; the list of known suppliers; then the rules — copy numbers literally, never compute or infer; leave unclear values empty and lower confidence; distinguish seller from buyer VAT by *position in the document*, not by shape; a document reading "عرض سعر"/Quotation/Proforma is not an invoice however similar; a document with multiple dated transactions and a carried balance is a statement, not an invoice; dates in Gregorian `YYYY-MM-DD`, converting from Hijri with lowered confidence; confidence must be an honest estimate of legibility.

### Operations that call AI

Exactly one: `POST /api/analyze` → `extractDocument()`. Nothing else in the codebase calls any model.

### Capability boundaries

| | |
|---|---|
| Structured output enforced | **Yes** — provider-side schema + zod `safeParse`; a non-conforming response is a typed failure, not a partial write. |
| Tool use | **No.** No tools, no function calling. |
| Database access | **No.** The model receives supplier *names* as text in the prompt; it cannot query. |
| Drive access | **No.** The model receives one file's bytes; it cannot list or read the archive. |
| Can it write anything | **No.** Its output is a JSON object that a human must confirm before any write. |
| Is it allowed to do arithmetic | **Explicitly forbidden by prompt**, and structurally irrelevant — all math is TypeScript. |
| Context limits | Not managed. Whole file goes in as base64. `max_tokens: 16000` on the Claude path only; Gemini has no output cap set. A very long PDF will simply fail. |
| Token usage | Recorded per call in the API response (`usage.inputTokens/outputTokens`) but **not persisted or aggregated**. No cost tracking. |

### Per-capability breakdown

- **A. Document extraction** — AI. Gemini, structured, temperature 0, human-reviewed.
- **B. Classification** — AI, as one enum field (`documentKind`) of the same call. Post-processed deterministically: quotations/proformas are hard-blocked from posting by `validateInvoice`, regardless of what the model says.
- **C. Financial calculations** — **100% deterministic TypeScript.** No AI.
- **D. Financial analysis** — 100% deterministic (`analytics.ts`). No AI.
- **E. Management reports** — `insights.ts` produces the Arabic recommendations on `/dashboard`. These are **hand-written template strings filled with computed numbers and sorted by severity then financial impact** — there is no LLM involved. They read as if written by an advisor, but they are rule-based.
- **F. Natural-language questions** — **not implemented.** There is no chat, no Q&A, no text-to-SQL.

### Error handling and retry

Gemini: 4 attempts, retry on `{429,500,502,503,504}` and network failures, exponential backoff (`GEMINI_RETRY_BASE_MS`, default 1000 ms, settable to 0 in tests — 3 tests guard this behaviour). Distinct messages for quota, overload, and unknown-model. `finishReason` outside `{STOP, MAX_TOKENS}` is a failure. Non-JSON or schema-invalid output is a failure. Claude: no retry; typed handling for `RateLimitError`, `AuthenticationError`, `APIError`, refusal, and `max_tokens`. Ollama: no retry; connection failure gives a "run `ollama serve`" message.

### Prompt-injection posture

Input is an untrusted supplier document. Because output is schema-constrained to fixed keys and the model has no tools and no database access, the realistic injection ceiling is *wrong field values* (e.g. a document that convinces the model it is a different supplier or a different amount). That is bounded by: supplier matching against the registry (a name the model invents will not match and will block), the VAT arithmetic cross-check, mandatory human review, and React's automatic escaping (extracted strings are rendered as text, never as HTML). **No explicit anti-injection instruction exists in the prompt**, and extracted strings flow into Drive filenames with no sanitisation beyond the user's own edit.

---

## 10. SECURITY

### What exists

| Control | Implementation |
|---|---|
| Authentication | Google OAuth only. No passwords, no email/password path. |
| Session | Auth.js **database** strategy; opaque token in an HTTP-only cookie; `sessions` table. |
| Allowlist | `ALLOWED_EMAILS="email:ROLE,…"`. An unlisted Google account is rejected in the `signIn` callback. Currently 1 entry. |
| Deactivation | `users.is_active = false` blocks login even if still allowlisted. |
| Authorization | Capability matrix (`src/lib/permissions.ts`, 12 capabilities × 3 roles), enforced server-side in every route handler and every page. 9 tests. |
| Route guard | `middleware.ts` — first layer only; every route re-checks. API routes get `401 JSON` instead of an HTML redirect (so `fetch` sees a real error). |
| Secret storage | All secrets in environment variables; `.env` gitignored with an explicit `!.env.example` exception; Vercel stores them as encrypted secrets. Drive folder IDs are env-only, never in code. |
| Google tokens | `refresh_token` in the `accounts` table, **plaintext**, protected only by database access control. |
| Drive scoping | Uploads use the acting user's own credentials — activity is attributable to a person. |
| Delete safety | No delete/move function exists in the Drive layer at all. |
| Audit immutability | Three database triggers block UPDATE, DELETE and TRUNCATE on `audit_logs`. Verified live. |
| Transactions | Multi-table writes are wrapped in `db.transaction`. |
| SQL injection | Drizzle parameterises everything; raw `sql` fragments interpolate only column references and Drizzle-escaped values. |
| Health endpoint | Deliberately reports presence/booleans, never values. Public (in `PUBLIC_PATHS`). |

### Vulnerabilities and missing protections

1. **Client-trusted business flags (highest severity).** `/api/archive` persists `isTaxValid`, `inputVatEligible`, `isFixedAsset`, `subtotal`, `vat`, `total`, and the `findings` array exactly as the browser supplies them. The BLOCKER gate reads that same client array. Any authenticated user — or a stale/altered client — can archive an invoice that violates every validation rule. The fix is to re-run `runPipeline`/`validateInvoice` on the server against the uploaded bytes' extraction, or at minimum recompute validation from the submitted amounts.
2. **Amount disclosure to `PURCHASING`.** `/api/analyze` requires `document:upload` and returns full monetary values; `amounts:view` is enforced only in the UI.
3. **No rate limiting anywhere.** `/api/analyze` triggers a paid/quota'd model call and accepts 25 MB per request. `/api/bank-import` parses a 15 MB spreadsheet synchronously. Both are trivially abusable by any allowlisted user or via a stolen session.
4. **MIME type is client-declared.** `file.type` from the browser is trusted; no magic-byte sniffing. A mislabelled file reaches the model and Drive.
5. **`AUTH_BYPASS` exists as a production environment variable.** It is `false` today (confirmed via `/api/health`), but a single dashboard edit opens the entire application, including the owner's Drive-writing token, to anyone with the URL. It should not exist in the production environment at all.
6. **Refresh tokens stored in plaintext.** A database read grants full Drive access to the owner's account (scope is full `drive`, not `drive.file`).
7. **Over-broad Drive scope.** `https://www.googleapis.com/auth/drive` grants read/write to the user's *entire* Drive. `drive.file` would suffice for files the app creates, though it would not cover the archive-reading migration.
8. **No CSRF tokens on the custom API routes.** Mitigated in practice by Auth.js's `SameSite=Lax` session cookie and the fact that all state-changing routes are `POST` with JSON or multipart, but it is not an explicit control.
9. **Secrets exposed in conversation.** `GEMINI_API_KEY` and `GOOGLE_CLIENT_SECRET` were pasted into a chat transcript; the client-secret JSON also sits in `~/Downloads`. **Both should be rotated.**
10. **Preview deployments may share the production database** (`[UNKNOWN]`, see §2). Any PR preview would then write to real financial data.
11. **No security headers.** `next.config.ts` is empty — no CSP, no HSTS beyond Vercel's default, no `X-Frame-Options`.
12. **No user management UI.** `users:manage` is defined as a capability but nothing implements it; adding a user means editing an environment variable and redeploying.
13. **No logging or alerting on authorization failures.** `ForbiddenError` becomes a 403 and vanishes.

---

## 11. FRONTEND

Seven routes, all Arabic RTL, all rendered as Server Components except two client islands. Design: pure black/white high contrast with `prefers-color-scheme` dark mode; colour reserved exclusively for state (ok green, warn amber, danger red) so a warning is the only coloured thing on screen. Thmanyah Sans for body, Thmanyah Serif Display for headings, both self-hosted `woff2`. A web manifest makes it installable as a full-screen iOS home-screen app.

| Route | What it actually does | Real or mock |
|---|---|---|
| `/` (Upload) | Drag-drop / file-picker / phone camera. Per-file card with extracted fields, editable invoice number, date, total, VAT and filename; amber outlines on low-confidence fields; finding chips; live upload progress with a seconds counter and a "the server is slow" note after 30 s; on success the card is cleared into a session list with a Drive link and `router.refresh()`. Below: 4 stat tiles (supplier count, suppliers needing a contract, archived documents, active extraction provider) and the full supplier list. | **Real** |
| `/dashboard` | 8 KPI tiles; the ranked recommendations list; monthly-spend bars; top-suppliers bars; the aging table. Requires `reports:view`. | **Real data, but see §2** — VAT tiles read 0 because migrated invoices carry no VAT; `duplicatePaymentCount` is hardcoded `0`. |
| `/audit` | 4 tiles; price-change table (previous vs current unit price, % move, estimated annual impact); invoice table (latest 100 of up to 500) with payment state, tax validity, posting state; unposted and fixed-asset counters; the "invoices costing us input VAT" list. Requires `amounts:view`. | **Real**, but the price table is empty (1 line row) and the VAT list is empty (`vat_minor = 0`). |
| `/analysis` | 4 tiles; "same item, two prices" table with estimated saving; "items approaching reorder" list computed from each item's own historical cycle; top-40 items by spend with order count, quantity, average unit price, cycle, last ordered. Requires `amounts:view`. | **Real code, effectively empty data.** Shows its empty state today. |
| `/payments` | Payment run for a month (defaults to the previous month): ready-to-transfer grouped by supplier, held invoices with the reason, VAT-at-risk tile, a CSV download link, and a pre-filled WhatsApp message per supplier asking for a proper tax invoice. Requires `payment:approve`. | **Real** |
| `/bank` | Two explicit options: (1) upload the bank statement → preview (counts, sample matches, largest unknown transfers, duplicate warning) → "approve and match"; (2) "consider them all paid" with a confirmation dialog that states the count and that the owner's name will be recorded. Requires `bank:view`. | **Real** |
| `/suppliers` | Full registry table: name, slug, alias count, category, VAT number (or an amber "missing"), invoice count, billed total, balance, statement count. Amounts hidden without `amounts:view`. A banner lists suppliers who issue no invoices and have no contract on file. | **Real** |
| `/login` | Google sign-in with specific Arabic messages for `AccessDenied`, `Configuration`, `Verification`, `OAuthAccountNotLinked`, `OAuthCallback`, `OAuthSignin`, `Callback`. | **Real** |

**Pages that do not exist:** Documents/archive browser, Products, Sales, Reports (beyond the three above), Settings, a Drive browser, an Issues/exceptions queue, Users, Month close, Supplier statement reconciliation.

**No mock or placeholder data ships in the app.** A demo seeder (`scripts/seed-demo.ts`) exists as a local CLI tool, marks everything it creates with `DEMO-`, and has a `--clear` flag; it was used once and its data was removed. Nothing demo-related is in the database now.

---

## 12. BACKEND / API

| Endpoint | Method | Auth | Purpose | Input | Output | DB | AI | Drive | Errors |
|---|---|---|---|---|---|---|---|---|---|
| `/api/analyze` | POST | `document:upload` | Read a document, extract, match, validate, propose name/folder | `multipart` `file` | JSON: extraction, supplier match, pipeline result, model, usage, sha256 | reads suppliers, aliases, documents(sha), invoices(numbers) | **yes** | no | 400 bad/empty/oversize/unsupported · 401 · 403 · 502 extraction |
| `/api/archive` | POST | `document:upload` | Upload to Drive + persist | JSON incl. `fileBase64`, all confirmed fields, `findings`, `lines` | `{ok, documentId, fileName, renamed, driveFileId, webViewLink, correctedFields}` | writes documents, invoices, invoice_lines, statements, payments, issues, audit_logs (one tx) | no | **yes** (create folder, list, create file) | 400 · 401 · 403 · 409 blocker/duplicate · 428 no Drive token · 502 Drive |
| `/api/bank-import` | POST | `bank:view` | Parse + match a bank statement | `multipart` `file`, optional `apply=true` | preview JSON, or `{applied, summary, created, importId}` | reads suppliers/aliases/invoices/allocations; writes bank_imports, bank_transactions, payments, payment_allocations, audit_logs | no | no | 400 · 401 · 403 |
| `/api/mark-paid` | POST | `payment:approve` | Owner asserts invoices are paid | JSON `{invoiceIds?, throughMonth?, supplierId?, note?}` | `{ok, marked, totalMinor, message}` | writes payments, payment_allocations, audit_logs | no | no | 400 no scope / bad month · 401 · 403 |
| `/api/payment-run` | GET | `payment:approve` | Bulk-transfer CSV | `?month=YYYY-MM` | `text/csv` with UTF-8 BOM (so Arabic opens correctly in Excel), `Content-Disposition: attachment` | reads invoices, suppliers, allocations | no | no | 400 bad month · 401 · 403 |
| `/api/health` | GET | **public** | Diagnose without exposing secrets | — | `{healthy, checks:{database{ok,latencyMs}, dbEndpoint{host,pooled}, extraction{provider,keyPresent}, google{clientConfigured,allowlistCount}, auth{bypassed}, drive{foldersConfigured}}}` | `select 1` | no | no | 503 when unhealthy |
| `/api/auth/[...nextauth]` | GET/POST | — | Auth.js handlers | — | — | users/accounts/sessions | no | no | Auth.js |

All handlers set `runtime = "nodejs"`; the four heavy ones set `maxDuration = 60`. Error mapping is uniform: `UnauthenticatedError → 401`, `ForbiddenError → 403`, everything else rethrown.

### Key library functions

`extractDocument` · `runPipeline` · `matchSupplier` · `validateInvoice` · `parseRiyals` / `formatRiyals` · `buildInvoiceFileName` / `parseFileName` / `resolveNameCollision` / `splitSlugAndBeneficiary` · `monthOf` / `nextMonth` / `previousMonth` / `resolveReceiptFiling` / `drivePathFor` · `normalizeItem` / `detectPriceChange` · `summarizeItems` / `buildAging` / `findPriceGaps` / `vatAtRisk` / `spendByMonth` / `paymentStatus` · `buildInsights` · `buildPaymentRun` / `toBankTransferCsv` / `buildSupplierMessage` · `parseBankStatement` / `matchBankTransactions` / `findSupplierInText` / `findInvoiceCombination` / `findDuplicatePayments` · `findOrCreateFolder` / `existingNamesIn` / `uploadFile` / `listChildren` · `recordAudit` / `diffCorrections` · `can` / `require_` / `parseAllowlist` · `currentUser` / `requireUser` / `isAuthBypassed`

---

## 13. FILE STRUCTURE

```
TPH Invoicing/
├── AGENTS.md, CLAUDE.md          Agent instructions (auto-written by `next dev`)
├── README.md                     Arabic overview, phase table, setup
├── apphosting.yaml               Firebase App Hosting config — complete, UNUSED
├── drizzle.config.ts             schema→./src/db/schema.ts, out→./drizzle, snake_case
├── vitest.config.mts, eslint.config.mjs, postcss.config.mjs
├── next.config.ts                EMPTY — no headers, no CSP, no image config
├── .github/workflows/ci.yml      typecheck → lint → test → build
├── docs/
│   ├── PLAN.md                   25 KB full architecture/phase plan
│   ├── SETUP.md                  10 KB step-by-step Google/Neon/Vercel setup
│   └── HANDOVER.md               this document
├── drizzle/sql/001_audit_log_immutable.sql   3 triggers; NO generated migrations
├── reports/                      gitignored migration reports (3 runs)
├── scripts/                      local CLI only, run via tsx, NOT deployed
│   ├── drive-auth.ts             OAuth flow → refresh token (read-only by default)
│   ├── drive-inventory.ts        read-only archive census + slug/alias inference
│   ├── migrate-archive.ts        THE archive→DB importer (--dry | --commit)
│   ├── seed-suppliers.ts         idempotent supplier + alias seeding
│   ├── seed-demo.ts              DEMO- prefixed fake data, with --clear
│   ├── diagnose-drive.ts         times each Drive step without uploading
│   └── try-extract / try-archive / try-bank / try-match.ts
└── src/
    ├── auth.ts                   Auth.js config, allowlist, role resolution
    ├── middleware.ts             cookie-presence route guard
    ├── config/drive.ts           folder IDs, service folder names, VAT_RATE 0.15,
    │                             FIXED_ASSET_THRESHOLD_MINOR 300000, company config
    ├── db/
    │   ├── schema.ts             17 tables + enums + Drizzle relations (~430 lines)
    │   └── index.ts              pg Pool (max 1 on Vercel), explicit timeouts
    ├── lib/
    │   ├── money.ts              halalas; Arabic numeral parsing
    │   ├── naming.ts             filename build/parse for the real archive
    │   ├── filing.ts             which month a document belongs to
    │   ├── validation.ts         Saudi VAT + fixed-asset rules
    │   ├── issue-codes.ts        20 issue codes with severity + Arabic text
    │   ├── permissions.ts        capability matrix, allowlist parsing
    │   ├── session.ts            currentUser / requireUser / AUTH_BYPASS
    │   ├── audit.ts              recordAudit + diffCorrections
    │   ├── id.ts                 randomUUID
    │   ├── suppliers-seed.ts     24 suppliers, bank aliases, normalizeName, KNOWN_SLUGS
    │   ├── supplier-match.ts     VAT→ALIAS→NAME→FUZZY
    │   ├── items.ts              item normalization, unit map, price-change detection
    │   ├── analytics.ts          all reporting math (pure)
    │   ├── insights.ts           rule-based Arabic recommendations (pure)
    │   ├── payment-run.ts        month payment run, CSV, WhatsApp text
    │   ├── drive.ts              Drive access — NO delete, NO move, by design
    │   ├── bank/parse.ts         SNB Excel → rows (header-by-name)
    │   ├── bank/match.ts         distinctive-token supplier ID, invoice combinations
    │   └── extraction/
    │       ├── schema.ts         zod extraction contract
    │       ├── provider.ts       provider interface + shared Arabic instructions
    │       ├── extract.ts        Claude provider (claude-opus-5)
    │       ├── provider-gemini.ts Gemini provider + hand-written OpenAPI schema + retry
    │       ├── provider-ollama.ts local vision model provider
    │       ├── pipeline.ts       pure decision engine
    │       └── index.ts          provider selection
    ├── app/
    │   ├── layout.tsx, globals.css, fonts.ts, manifest.webmanifest
    │   ├── page.tsx (upload) · dashboard · audit · analysis · payments · bank
    │   │   · suppliers · login
    │   └── api/ analyze · archive · bank-import · mark-paid · payment-run
    │           · health · auth/[...nextauth]
    ├── components/ uploader.tsx · bank-import.tsx · nav.tsx · page-shell.tsx
    │               · trial-banner.tsx · user-menu.tsx
    └── fonts/ Thmanyah woff2 (5 sans + 2 serif) + licence PDFs
```

~10,650 lines of TypeScript/TSX across `src/` and `scripts/`.

---

## 14. ENVIRONMENT & DEPLOYMENT

**Language/runtime:** TypeScript 5 (`strict: true`), Node 20, ESM, path alias `@/* → ./src/*`.
**Framework:** Next.js 16.3.4 App Router. **Package manager:** npm (`package-lock.json`).
**Styling:** Tailwind CSS v4 via `@tailwindcss/postcss`, CSS custom properties for the palette.
**Database:** Neon serverless Postgres, `pg` driver + Drizzle. **Testing:** Vitest 4.1.11.

### Dependencies (production)

`@anthropic-ai/sdk ^0.123.0` · `@auth/drizzle-adapter ^1.11.3` · `drizzle-orm ^0.45.2` · `googleapis ^178.0.0` · `next 16.3.4` · `next-auth ^5.0.0-beta.32` · `pg ^8.23.0` · `react/react-dom 19.2.8` · `xlsx ^0.18.5` · `zod ^4.5.4`

Dev: `drizzle-kit ^0.31.10` · `tsx ^4.23.13` · `vitest ^4.1.11` · `dotenv ^17.4.2` · `tailwindcss ^4` · `eslint 9` + `eslint-config-next 16.3.4` · `typescript ^5` · `@types/*`

> `next-auth` is on a **beta** release, and `xlsx 0.18.5` is the last npm-registry version (later versions ship from the vendor's own CDN and this one has known advisories). Both are supply-chain considerations. Prisma was removed earlier in favour of Drizzle, which also cleared 4 high-severity advisories.

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Neon **pooled** connection string. The direct endpoint exhausts connections in serverless and hangs silently — a bug that cost real debugging time. |
| `AUTH_SECRET` | yes | Auth.js signing |
| `AUTH_URL` | yes | Canonical origin |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | yes | OAuth + Drive |
| `ALLOWED_EMAILS` | yes | `email:ROLE,…` login allowlist |
| `DRIVE_ACCOUNTS_FOLDER_ID` | yes | `1YCpJT2Qu4Ayvh2ZwCwcu1KA3qmDx_eor` |
| `DRIVE_YEAR_2026_FOLDER_ID` | yes | `1N8Lp4xxpHWuLgA1LWKpSe9Ox3GhAsEMl` |
| `DRIVE_YEAR_2027_FOLDER_ID` | yes | `1mG_zGvM8bljFyStmijGeY5cb9zeo-4Bq` |
| `COMPANY_VAT_NUMBER` | yes | `310007971600003` — the buyer-VAT check depends on it |
| `COMPANY_NAME_AR`, `COMPANY_CR_NUMBER` | optional | Prompt + display |
| `EXTRACTION_PROVIDER` | default `claude` | Currently `gemini` |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | when gemini | `gemini-flash-latest` |
| `ANTHROPIC_API_KEY` | when claude | **empty locally, absent on Vercel** |
| `OLLAMA_HOST`, `OLLAMA_MODEL` | when ollama | local only |
| `GEMINI_RETRY_BASE_MS` | optional | default 1000; 0 in tests |
| `AUTH_BYPASS` | optional | `true` disables login entirely. **`false` in production.** |
| `GOOGLE_DRIVE_REFRESH_TOKEN` | optional | CLI-only fallback |

### Build & deploy

- Build: `next build`. CI additionally builds with dummy env values (no real database contact).
- Deploy: git push → Vercel builds → Production. 13 Ready production deployments; the newest 23 minutes before this report; build times 31–59 s.
- Schema changes: `npm run db:push` (manual, from a developer machine). The audit trigger SQL must be applied manually once — it **is** applied in production.
- Local: `npm install` → `cp .env.example .env` → fill → `npm run db:push` → `npm run db:seed` → `npm run dev`.

### Required external accounts

Google Cloud (OAuth client + Drive API + Gemini key from AI Studio) · Neon · Vercel · GitHub. Firebase is configured for but not used.

### Current deployment status

`GET /api/health` → `{"healthy":true, database ok 143 ms, dbEndpoint pooled:true, provider gemini keyPresent:true, google configured allowlistCount:1, auth.bypassed:false, drive foldersConfigured:true}`. All seven app routes return `307 → /login` when unauthenticated; `/login` returns `200`.

---

## 15. TESTING

**215 tests, 15 files, all passing, 446 ms** (`npm test`, Vitest). `npx tsc --noEmit` is clean.

### Unit tests (all that exist)

| File | Tests | Covers |
|---|---:|---|
| `lib/analytics.test.ts` | 26 | payment status, aging buckets, item summarisation, price gaps, VAT at risk, monthly spend |
| `lib/naming.test.ts` | 26 | build + parse for all four filename shapes, month-only dates, missing amounts, `SAR410` rejection, slug/beneficiary splitting, collision suffixes |
| `lib/bank/match.test.ts` | 21 | internal-noise detection, distinctive-token supplier ID, stopwords, invoice combinations (1/2/3/whole-group), claim exclusivity, duplicate detection |
| `lib/extraction/pipeline.test.ts` | 21 | end-to-end pure pipeline: kinds, findings, blockers, filenames, folders, `canArchive` |
| `lib/insights.test.ts` | 17 | every recommendation rule, ordering by severity then impact |
| `lib/extraction/provider.test.ts` | 17 | provider selection, instruction building, Gemini retry behaviour and backoff |
| `lib/items.test.ts` | 15 | Arabic normalisation, unit-form mapping, price-change detection with repeated prices |
| `lib/payment-run.test.ts` | 12 | scoping, holds, grouping, CSV, WhatsApp message |
| `lib/validation.test.ts` | 12 | the four tax-invoice pillars, VAT arithmetic, fixed-asset basis, confidence threshold |
| `lib/filing.test.ts` | 10 | month arithmetic, carry-forward rule, receipt filing |
| `lib/supplier-match.test.ts` | 10 | VAT/alias/name/fuzzy ordering, similarity, ambiguity |
| `lib/permissions.test.ts` | 9 | matrix, allowlist parsing |
| `lib/suppliers-seed.test.ts` | 9 | seed integrity, `normalizeName` |
| `lib/audit.test.ts` | 5 | correction diffing |
| `lib/money.test.ts` | 5 | Arabic-Indic digits, separators, rounding, formatting |

### What has **no** automated tests

Integration tests: **none**. Google Drive tests: **none** (verified manually with `try-archive.ts` / `diagnose-drive.ts`). AI tests: only provider *selection* and *retry* — no extraction-accuracy suite, no golden-document set. Database tests: **none** (no test database, no fixtures, no transaction rollback harness). File-upload tests: **none**. API route tests: **none**. Financial-calculation tests: yes, at the pure-function level — but **not** end-to-end through the API. E2E/browser tests: **none**.

### Manual verification performed

Archive parsing against all 161 real Drive files (153 understood); migration of 154 documents; bank parsing of the real 1,428-row statement with 0 warnings; bank matching improving 36 → 47 invoices after adding real bank aliases; live login; live upload to Drive; all seven pages returning 200 while authenticated.

---

## 16. KNOWN PROBLEMS

**Correctness / integrity**

1. Server does not re-validate client-supplied financial flags or findings in `/api/archive`. (§10.1)
2. Silent invoice loss when `total` fails to parse — Drive upload succeeds, no invoice row, no error shown.
3. `subtotal` is not user-editable but `total`/`vat` are → stored invoices can be arithmetically inconsistent.
4. `TYPE_TOKENS` lacks `taxinvoice`; a real 11,600 SAR invoice failed migration and is missing from the database.
5. `mark-paid` fabricates `paid_at` from the invoice date.
6. `mark-paid` and `bank-import` write `action: "DOCUMENT_ARCHIVED"` into the audit log — a label that is simply wrong.
7. `duplicatePaymentCount: 0` is hardcoded on `/dashboard`.
8. `findInvoiceCombination` caps its pool at 14 invoices and drops the rest silently.
9. Bank import is not idempotent — re-uploading duplicates `bank_transactions` rows.
10. `resolveInvoiceFiling` (the carry-forward rule, tested) is never called by the pipeline.

**Data quality (current state)**

11. `invoice_lines` = 1 row → `/analysis` and price tracking are empty.
12. 122/123 invoices have `subtotal = vat = 0` → all VAT KPIs are wrong, and read as "0 at risk" rather than "unknown".
13. 1/123 invoices is `is_tax_valid` → the payment run will hold essentially everything.
14. 153/154 documents have `sha256 = NULL` → content-duplicate detection does not cover the migrated archive.
15. `posted_to_accounting` is `false` on all 123 invoices and nothing can ever set it — there is no posting flow.
16. Duplicate supplier rows deliberately seeded: `HungryMan` / `HungryManBakery`, `Ganache` / `Ganache-AGK` (second spellings found in the archive, "to be merged later" per the seed file's own notes). This splits their spend across two rows in every report.
17. `SabeaJar` is a **customer**, not a supplier, but sits in the `suppliers` table.

**Missing features (see §2 `[PLANNED]`)**

18. No documents list / archive browser / search. `drive_file_id` is stored for 154 documents and surfaced nowhere.
19. No issues queue — `issues` rows are written and never read.
20. No supplier CRUD; adding a supplier means editing source and running a script.
21. No in-app Drive refresh; only the CLI migration.
22. No month close, no statement reconciliation, no alerts, no accounting export.
23. Only 2026 and 2027 are mapped in `driveConfig.yearFolderIds`; 2028 fails.

**Operational / technical debt**

24. No generated migrations — schema is `drizzle-kit push` only.
25. No rate limiting, no request logging, no error tracking (no Sentry or equivalent).
26. `next.config.ts` is empty — no security headers.
27. Base64-in-JSON upload body (~33% size inflation) instead of a direct multipart or resumable upload.
28. Reporting pages fetch all rows and compute in Node; `/analysis` has `.limit(20000)` on lines and `/audit` `.limit(5000)` / `.limit(500)` — arbitrary caps that will silently truncate as data grows.
29. `documents.raw_text`, `text_source`, `field_confidence` columns are dead.
30. `annualImpactMinor`, `priceKey`, `driveFromEnv`, `capabilitiesOf`, `hasBlocker` are unused exports.
31. `GEMINI_SCHEMA` duplicates `extractionSchema` by hand and can silently drift.
32. Test junk in the real Drive archive: `ACCOUNTS/2026/2026-08/BeCof (بيكوف)/2026-08-13_BeCof_Invoice_00282_SAR150.00 (2).pdf` — an empty file uploaded during diagnosis, deliberately left in place because the owner's standing instruction forbids deleting anything from Drive without an explicit request.
33. Secrets in need of rotation: `GEMINI_API_KEY`, `GOOGLE_CLIENT_SECRET`.

---

## 17. ARCHITECTURAL RISKS

**Scalability.** Fine for this business (≈35 invoices/month) and structurally wrong for growth: every report loads whole tables into Node. Item aggregation is O(lines) in JavaScript on every page view with no caching. At ~50k lines the dashboard becomes slow; at ~500k it fails. The fix is SQL aggregation and materialised views, not more limits.

**Reliability.** Single points of failure: Neon (no read replica, `max: 1` connection on Vercel), Gemini free tier (a 429 stops all uploads), and the user's Google refresh token (revoke it and all uploads return 428). The Drive-succeeded/DB-failed window leaves orphan files that nothing detects. `maxDuration = 60` against a large scanned PDF plus 4 retries is a plausible timeout.

**Data integrity.** The client-trusted-flags hole (§10.1) is the top risk. Beyond it: no CHECK constraints, no idempotency on bank import, `mark-paid` writes fictional payment dates, and no reconciliation between Drive and the database. Positives: integer money, the immutable audit log, the unique `(supplier_id, invoice_number)`, and transactional multi-table writes.

**AI hallucination.** Well contained — schema-constrained output, no arithmetic, mandatory human review, raw output preserved, corrections diffed. The residual risk is a *plausible misread* (subtotal read as total, one wrong digit) that a tired reviewer approves. The `subtotal + vat = total` check catches a good share of these; nothing catches a consistently-wrong-but-self-consistent misread.

**Financial calculation.** The math is deterministic and tested. The risk is *inputs*: 122 invoices with zero VAT produce confident-looking dashboard numbers that are wrong. Presenting "0 SAR at risk" when the honest answer is "unknown for 122 invoices" is the most dangerous single behaviour in the product.

**Drive synchronisation.** No two-way sync, no change watching, no reconciliation. The database is a write-once shadow of Drive that drifts the moment anyone touches Drive by hand — and the owner does work in Drive by hand.

**Security.** See §10. Highest: client-trusted flags, no rate limiting, `AUTH_BYPASS` present in the production environment, plaintext refresh tokens with full `drive` scope.

**Cost.** Currently ~zero (Vercel Hobby, Neon free, Gemini free). The free tiers are also the risk: Gemini free-tier terms allow Google to use submitted invoice data to improve its products, with possible human review. This is a documented, knowing, temporary choice — but it is a *confidentiality* cost, not a monetary one, and it should be revisited before the archive grows.

**Vendor lock-in.** Low-to-moderate and well handled. The AI provider is a one-line swap behind a clean interface. Postgres/Drizzle is portable. Vercel↔Firebase is prepared (`apphosting.yaml`). The genuine lock-in is **Google Drive as the system of record** — the app stores no bytes, so Drive is not a cache, it is the archive.

**Performance bottlenecks.** Model latency (seconds to a minute per document) is the dominant cost and is inherently serial per upload; base64 inflation on the archive request; two sequential Drive round-trips per upload before the file transfer even begins; `bank-import` parsing 1,428 rows and running combination search synchronously inside a 60 s request.

---

## 18. WHAT WE HAVE BEEN TRYING TO BUILD

### Intended product

An **operating system for a café's purchasing side**: every supplier document captured at the moment it arrives, read automatically, filed correctly, checked against Saudi VAT rules before money moves, reconciled against the bank and against supplier statements, closed monthly, exported to the accounting system, and continuously mined for advice — *"this item went up 12% at this supplier, here's what it costs you per year, here's who to call."*

Guiding principles visible throughout the code:

- **The Drive archive is sacred.** No delete, no move, no rename functions exist. Not policy — absence.
- **Money is never a float.** Integers everywhere, because "3,400 booked as 1,700" is the founding story.
- **Nothing posts without a human.** The AI proposes; a person confirms; the difference is recorded forever.
- **Silence is the enemy.** Blank beats guessed; a rejected `SAR410` beats a silently accepted typo; an explicit timeout beats a spinner that never ends.
- **The audit log is enforced by the database, not by convention.**
- **Advice must carry a number.** Every recommendation has a riyal impact and a next step.

### CURRENT REALITY vs INTENDED FUTURE STATE

| Dimension | Current reality | Intended |
|---|---|---|
| Capture | Manual drag-drop, one file at a time | Same, plus automatic Drive-change ingestion for files added by hand |
| Reading | Gemini free tier, ~16 fields, human-reviewed | Same, on a paid/private model, with an accuracy benchmark |
| Line items | 1 row in the whole database | Every invoice's lines, powering real consumption analysis |
| Suppliers | 24 seeded from source code | Managed in the UI, with contracts, terms, and VAT certificates |
| Payment | Bank matching (47 invoices) + owner assertion | Full reconciliation, alerting on unmatched and duplicate transfers |
| Statements | 11 header rows, no lines | Line-level reconciliation with a discrepancy memo per supplier |
| Month close | Nothing | Checklist, lock, and an immutable closed-period record |
| Accounting | Nothing | Export to Foodics + reverse reconciliation |
| Sales/COGS | Not modelled | POS ingestion → real food-cost and margin |
| Alerts | One `wa.me` link | Scheduled email + prepared WhatsApp per supplier |
| Users | 1 | 3 roles actually in use, managed in-app |
| Archive access | Session-only links | Searchable document browser |

---

## 19. REMAINING WORK

### P0 — must be done before this is trusted with money

1. **Re-validate on the server in `/api/archive`.** Recompute `validateInvoice()` from the submitted amounts (or re-run extraction server-side) and derive `isTaxValid` / `inputVatEligible` / `isFixedAsset` / blockers there. *Why: today the browser decides whether an invoice is tax-valid. Everything downstream — VAT recovery, the payment run, the audit trail — inherits that decision.*
2. **Fail loudly when an invoice cannot be created.** Return an error instead of archiving a document with no invoice row. *Why: silent data loss in a financial system is the worst possible failure mode, and it currently reports success.*
3. **Backfill the archive by re-reading document content.** Run extraction over the 154 archived Drive files to populate `subtotal`, `vat`, `lines`, and `sha256`. *Why: it is the single change that turns three half-empty pages into working ones and makes the VAT numbers true. Estimated ~2 hours on the free tier.*
4. **Report unknown as unknown.** While VAT data is missing, the dashboard must say "VAT unknown for N invoices", never "0 SAR at risk". *Why: a confidently wrong zero is worse than a blank.*
5. **Rate-limit `/api/analyze`, `/api/archive`, `/api/bank-import`.** *Why: one loop exhausts the Gemini quota and blocks the owner's actual work.*
6. **Rotate `GEMINI_API_KEY` and `GOOGLE_CLIENT_SECRET`; remove `AUTH_BYPASS` from the production environment.** *Why: both keys were exposed in a transcript; a one-click env change currently disables all authentication.*
7. **Make bank import idempotent** (hash the file, or a unique key on `(bank_import_id, row_number)` plus a duplicate-import warning). *Why: a second click doubles the transaction ledger.*
8. **Confirm the Preview environment does not point at the production database.** *Why: if it does, any preview deployment writes to real financial records.*

### P1 — important, needed for daily use

9. **Bank-alias learning UI** — for every unrecognised transfer, a dropdown of suppliers; the choice writes a `supplier_aliases` row with `source: 'LEARNED'` so the next import matches it. *(Explicitly requested by the owner.)*
10. **Incremental Drive sync in-app** — a button that lists Drive, diffs against `documents.drive_file_id`, and ingests only new files, rather than the CLI full migration. *(Explicitly requested.)*
11. **Documents page** — searchable list with the Drive link, filters by month/supplier/kind/status.
12. **Issues queue** — surface the `issues` table with resolve/waive actions; today the codes exist, the rows are written, and no one can ever see them.
13. **Add `taxinvoice` to `TYPE_TOKENS` and re-run migration** to recover the missing 11,600 SAR invoice.
14. **Correct the audit action labels** and add `PAYMENT_RECORDED` / `BANK_IMPORTED` / `INVOICES_MARKED_PAID`.
15. **Supplier management UI** — create/edit suppliers, aliases, VAT numbers, contract flags.
16. **Merge the duplicate supplier rows** (`HungryMan`/`HungryManBakery`, `Ganache`/`Ganache-AGK`) and move `SabeaJar` out of `suppliers`.
17. **Make `subtotal` editable** in the uploader, or derive it as `total − vat` on the server.
18. **Adopt generated migrations** (`drizzle-kit generate`) and check them in.

### P2 — useful

19. Supplier statement reconciliation (parse → `statement_lines` → match → discrepancy memo).
20. Month close with checklist and period lock.
21. Alerts: scheduled email digest + prepared WhatsApp messages.
22. Accounting export (CSV/journal) with a defined Foodics mapping.
23. Wire the carry-forward filing rule into the pipeline, or delete it.
24. Drive ↔ DB reconciliation job that flags renamed/moved/trashed files and orphan uploads.
25. Move reporting aggregation into SQL; add caching or materialised views.
26. Error tracking and structured request logging.
27. Integration tests for the API routes with a throwaway Postgres.
28. An extraction accuracy benchmark over a labelled set of real documents.

### P3 — future

29. POS/Foodics sales ingestion → COGS, gross margin, food cost.
30. A real `products` entity with canonical names, units, pack sizes, categories.
31. Inventory and variance.
32. Natural-language Q&A over the data (this is where an LLM belongs *second*, after the deterministic layer is trustworthy).
33. Multi-tenancy, if this is ever to serve another café.
34. Move extraction to a paid/private model and delete the free-tier confidentiality caveat.

---

## 20. FINAL TECHNICAL ASSESSMENT

### Is the architecture fundamentally sound?

**Yes.** The core decisions are better than typical for a project of this size, and several are genuinely excellent:

- **The AI is confined to transcription.** It reads strings; TypeScript does all arithmetic. This is exactly the right boundary for a financial system, and most projects in this space get it wrong.
- **Integer halalas throughout**, with a parser that handles Arabic-Indic digits and separators.
- **Pure functions for all business logic** (`pipeline`, `analytics`, `validation`, `insights`, `payment-run`, `bank/match`) with no I/O — which is why 215 fast tests exist at all.
- **The audit log is immutable at the database layer**, TRUNCATE included.
- **The Drive layer physically cannot delete or move.** Safety by absence, not by discipline.
- **A clean provider interface** that makes the AI vendor a one-line decision.
- **Errors are typed unions, not exceptions**, across every provider boundary.

The comments in this codebase are unusually good: they record *why*, including the bugs that produced each rule (the pooled-endpoint hang, the `setState`-updater read, the TRUNCATE hole, `PURE-Oska` vs `Loreva-MaqamAlThiqa`).

### What would I change if starting today?

- **Server-authoritative validation from the start.** The pipeline should run on the server at archive time, not be trusted from the client. This is the one structural mistake.
- **A real `products` table** instead of `normalized_description` as an identity. String normalisation is a heuristic being used as a primary key.
- **Aggregate in SQL, not in Node.** The reporting pages should query views.
- **Extraction as a queued job**, not inside the HTTP request — which would also make the 154-document backfill a first-class feature rather than a CLI script.
- **`drive.file` scope**, plus a separate one-time read-only grant for the migration.
- **Generated migrations from day one.**

### What should NOT be changed

- The money representation.
- The AI/computation boundary.
- The pure-function business layer and its tests.
- The audit triggers.
- The no-delete Drive layer.
- The human-in-the-loop confirmation step with correction diffing.
- The provider abstraction.
- The Arabic-first, RTL, high-contrast UI — it is genuinely well built for the phone the owner will actually use.

### What should be refactored

- `/api/archive` — split into validate → upload → persist, with the validation server-side.
- Reporting pages — push aggregation into SQL.
- `suppliers-seed.ts` — replace source-code-as-database with real CRUD.
- `GEMINI_SCHEMA` — generate it from the zod schema with a translation layer, or add a test that asserts the two stay in sync.
- The uploader component (~500 lines) — extract the item card and the field editor.

### Is the AI architecture appropriate?

**Yes, with one caveat.** Using a vision LLM instead of an OCR pipeline is the right call for Arabic scanned invoices; structured output plus zod validation plus temperature 0 plus per-field confidence plus mandatory human review is a sound chain; and keeping the model out of arithmetic entirely is the decisive choice. The caveat is the **free tier**: Google's terms permit training on and human review of the submitted data, and these are real supplier invoices with VAT numbers and prices. The owner knows and accepted it temporarily. Moving to Claude or a paid Gemini tier is a one-line change and should happen before the corpus grows much larger.

### Is the Google Drive architecture appropriate?

**Yes for this business, with a real gap.** Keeping Drive as the archive of record means the owner keeps the filing system he already trusts and can use without the app — a genuine advantage for a small business. The write path (never overwrite, never delete, per-user credentials, collision-safe naming) is careful.

The gap is that synchronisation is **one-way and one-shot**. Nothing detects a file the owner renames, moves, or trashes by hand, and nothing detects an orphan uploaded when the database write failed. Because the owner *does* work directly in Drive, this drift is not hypothetical. A reconciliation pass — even a manual "check the archive" button — is needed.

### Is the database appropriate for financial analytics?

**The technology, yes; the schema, partly.** Postgres is right. Integer money, proper indexes, unique constraints on the pairs that matter, and an append-only audit table are all correct.

What is missing for analytics specifically: no product dimension, no sales facts, no date dimension, no CHECK constraints, no migrations, and no aggregation layer. It is a good *transactional* schema with analytics bolted on in application code. That works at 123 invoices and will not at 12,300.

### What would prevent this from becoming a reliable production system?

In order of severity:

1. **Client-trusted financial flags** — until validation is server-authoritative, no number this system produces can be defended to an auditor.
2. **The empty line-item table and zeroed VAT** — half the product's promise is unmet, and the VAT figures are not merely missing, they are *confidently wrong*.
3. **The silent-failure path in archive.**
4. **No Drive reconciliation** — the database will drift from the archive it claims to mirror.
5. **No rate limiting, no error tracking, no idempotency on bank import.**
6. **No migrations** — schema evolution is unrepeatable and unreviewable.
7. **Single-user, single-tenant assumptions** baked into the allowlist and the seed file.

None of these is architectural. They are all fixable inside the existing design. That is the most important thing to say about this codebase: **the foundations are right, and the gaps are gaps — not the consequences of bad structure.**

---

## PROJECT STATE SNAPSHOT

**1. What it is** — A single-tenant Arabic RTL web app that reads café supplier invoices with a vision LLM, files them into an existing Google Drive archive under strict naming rules, records them in Postgres, checks Saudi VAT validity, reconciles payments against a bank statement, and produces purchasing analytics and recommendations for one business in Jeddah.

**2. Current architecture** — Next.js 16.3.4 App Router (Server Components) on Vercel · Route Handlers as the backend · Neon Postgres via Drizzle ORM over a pooled `pg` connection · Auth.js v5 with Google OAuth and database sessions · Google Drive as the file system of record, written with the signed-in user's own OAuth token · Gemini for extraction behind a swappable provider interface · all business logic in pure, tested TypeScript functions · no queues, no cron, no webhooks, no background jobs.

**3. Current AI model** — `gemini-flash-latest` (Google Gemini free tier), `temperature: 0`, `responseSchema`-constrained JSON validated with zod, 4 retries with exponential backoff. Alternatives implemented but inactive: `claude-opus-5` (no API key configured) and local `qwen2.5vl:7b` via Ollama. AI has no tools, no database access, no Drive access, and performs no arithmetic.

**4. Current database** — Neon Postgres, 17 tables, integer-halala money, `YYYY-MM` accounting months, append-only `audit_logs` protected by three verified triggers. Live: 24 suppliers, 86 aliases, 154 documents, 123 invoices (118,158.41 SAR), **1 invoice line**, 11 statements, 27 payments, 47 allocations, 1,428 bank transactions, 0 issues, 0 month closes, 2 audit rows. No generated migrations — `drizzle-kit push` only.

**5. Google Drive architecture** — Per-user OAuth with full `drive` scope. `ACCOUNTS / <year> / <YYYY-MM> / <supplier folder>` plus four service folders. Files are named by strict convention, collisions get a ` (2)` suffix, and existing files are never overwritten. **No delete, move, or rename functions exist in the codebase.** `drive_file_id` is stored; there is no reverse synchronisation, no change watching, and no reconciliation.

**6. What works** — Login + role enforcement · document extraction and classification · supplier matching · VAT validation · filename and folder proposal · Drive upload · transactional persistence · immutable audit · bank statement parsing (1,428 real rows, 0 warnings) · bank matching (47 invoices) · duplicate-payment detection · payment run + CSV · all 7 pages · health endpoint · 215 passing tests · CI · production deployment.

**7. What doesn't** — Server-side re-validation (client is trusted) · line-item capture for the archive (1 row) · VAT figures (122 invoices at zero, reported as "0 at risk") · content-duplicate detection for migrated files (153 null hashes) · statement reconciliation · month close · issues UI · documents browser · supplier CRUD · in-app Drive refresh · accounting export · alerts · POS/COGS · idempotent bank import · the carry-forward filing rule (dead code) · one 11,600 SAR invoice lost to a missing filename token.

**8. Biggest technical risks** — (1) Client-supplied `isTaxValid`/`findings` persisted without server re-validation. (2) Confidently wrong VAT reporting from zeroed data. (3) Silent invoice-creation failure after a successful Drive upload. (4) Drive↔DB drift with no reconciliation. (5) Free-tier LLM terms permitting training on and human review of real invoice data. (6) No rate limiting on a quota-consuming endpoint. (7) `AUTH_BYPASS` present as a production environment variable. (8) No migrations, so schema changes are unrepeatable.

**9. Most important next 10 tasks**
1. Re-run validation server-side in `/api/archive`; stop trusting client flags and findings.
2. Fail loudly when an invoice row cannot be created.
3. Backfill all 154 archived documents by re-reading their content (VAT, subtotal, lines, sha256).
4. Report unknown VAT as unknown, never as zero.
5. Add rate limiting to the three heavy endpoints.
6. Rotate the exposed keys; delete `AUTH_BYPASS` from production.
7. Make bank import idempotent.
8. Build the bank-alias learning dropdown for unrecognised transfers *(owner-requested)*.
9. Build incremental in-app Drive sync *(owner-requested)*.
10. Build the documents browser and the issues queue so archived data and raised findings are reachable at all.

**10. Estimated production readiness — ~55%.**

Infrastructure, authentication, the Drive write path, and the business-logic core are production quality (~85%). The data currently inside the system is not (~30%: line items empty, VAT zeroed, tax-validity effectively absent). The write path has an integrity hole that must be closed before any number is defensible. Five planned subsystems — statement reconciliation, month close, accounting export, alerts, missing-items tracking — do not exist at all.

It is genuinely usable **today** for capture, filing, and bank reconciliation. It is not yet trustworthy for VAT reporting, consumption analysis, or anything an auditor would read.
