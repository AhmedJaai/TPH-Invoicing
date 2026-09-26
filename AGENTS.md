<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# TPH Invoicing — Agent Operating Standard

TPH Invoicing is a real financial application used daily by a real café.
**The product is the deliverable.** Reports, audits, and documentation are not.

Priorities, in order of tie-breaking:

- **Real implementation** over reporting
- **Product improvement** over checklist completion
- **User outcome** over technical activity
- **Evidence** over claims

Domain constraints (money in halalas, unknown ≠ zero, Drive archive untouchable,
Arabic UI, no fabricated sales data) live in `CLAUDE.md`. They are hard limits.
This file governs *how you work*.

## 1. What counts as success

A task succeeds only when the repository contains an improvement a user can
experience: less effort, fewer errors, faster workflows, clearer information,
stronger financial correctness, better reliability or visual quality.

It does **not** succeed because the code compiles, tests pass, docs were
written, a route was inspected, a checklist is done, or you say so.

## 2. Implement first

Investigate only until you can act, then act.

`understand → implement → test → inspect → criticize → fix → retest`

- Do not stay in analysis once you have enough to make a change.
- Do not write audits, plans, or review documents unless explicitly asked.
- Documentation follows code, and is short. A decision gets one or two lines in
  the matching `docs/decisions/*.md` file, not an essay — and never in
  `CLAUDE.md` unless nearly every task needs it. Never document intent that
  isn't implemented.

## 3. No checklist theater

Every claimed improvement needs evidence in at least one of: a code or schema
change, a passing behavioral test, observed rendered UI, a verified end-to-end
workflow, a measured improvement, or a reproduced-then-fixed defect.

- Never mark something done because it is "conceptually addressed".
- No cosmetic refactors or diff inflation to look productive.
- Before finishing, read your own `git diff` and ask: *does the app now behave
  materially better?* If not — or if the change is superficial relative to the
  problem — keep working.

## 4. Design around user jobs, not tables

Jobs: see what needs attention · enter/review an invoice · find a supplier ·
know what is owed · record and match a payment · import bank/Drive data ·
resolve exceptions · close a month · find anything fast.

A correct workflow that makes the user understand the database is a UX failure.

## 5. UX and visual standard

Do not preserve poor UX because it exists. Every screen should make the
important information and the next action obvious, minimize clicks and
re-entry, surface exceptions with a contextual action beside them, and show
clear loading / error / success states.

**Zero dead ends:** no fake or dead buttons, broken links, placeholder routes,
unexplained controls, silent actions, or forms without recovery. If a feature
isn't available, remove it or build it.

Visual quality means hierarchy, typography, spacing, density, and consistency.
**The design system is v2 (Sep 2026)** — a premium specialty-café finance desk:
warm paper canvas, white cards, one confident accent — the café's army dark olive «الزيتون» `#5A5444`,
a brand frame (sidebar) in that olive with cream highlights and the café's
own logomark (`BrandMark`), semantic colours always paired with an icon or
word, Thmanyah Sans for UI and Serif Display for the Home greeting, lucide
icons, 150–250 ms ease-out motion that respects `prefers-reduced-motion`.
Tokens live in `globals.css`, primitives in `ui.tsx` / `ui-client.tsx`; a
page never re-styles what a primitive owns. **"Restrained" must not become
"plain"** — go bold on hierarchy, layout and interaction; stay honest on data
(no decorative charts, no KPI without an answer and a destination).
Rationale and lessons: `docs/decisions/ui-ux.md`.

## 6. Financial correctness

Financial truth comes from deterministic code and database constraints — never
from a model's answer. AI may extract, classify, match, suggest, and flag;
the server recomputes and a human confirms.

Use validation, exact integer money, idempotency, explicit state transitions,
DB-level invariants, and correct transaction boundaries. Test duplicates,
retries, double clicks, concurrency, partial failure, malformed input, and
repeated imports / payments / reconciliation.

Never alter or delete historical financial data casually; destructive data
fixes need the owner's explicit approval.

## 7. Complete workflows

Build the whole path: start → input → validation → processing → result →
confirmation → follow-up → error recovery. Not just the happy path. Check what
happens on double submit, network failure, slow processing, existing data,
bad data, missing prerequisite, refresh, and partial failure.

## 8. Architecture

Simplest design that reliably serves the business. Don't keep bad architecture
because it's there; don't rewrite good architecture because it's old.
No duplicated business rules, scattered money calculations, hidden state
transitions, frontend-only enforcement, or speculative abstraction.
**Before adding a new module, wire up an existing unconnected one** (see
`CLAUDE.md` → «مبنيٌّ ولا يصل إليه أحد»).

## 9. Verification

`npm test`, `npm run typecheck`, `npm run lint` are necessary, not sufficient —
pure unit tests prove parts are sound, not that they are connected.

- Prefer tests of real workflows and DB behavior over implementation details.
- For any UI change, open the running app (browser preview) and look: layout,
  spacing, tables, forms, dialogs, empty/loading/error states, mobile width,
  RTL, overflow, console errors, failed requests. Fix what you find.
- New data-layer logic must be run against existing data in the same change.

## 10. Autonomy

Make reasonable product and engineering decisions yourself. Don't ask whether
to add a retry, make a page responsive, move a button, or simplify a flow.

Stop only for: credentials, genuinely missing external information,
irreversible business or financial-data decisions, or ambiguity the repo and
product context cannot resolve.

## 11. Think independently, then attack your own work

Ask: what is actually wrong? What is needlessly complex? What will annoy the
owner in six months? What mistake could a tired user make? What financial error
does this permit? What repetitive work could be automated?

Before finishing, assume your change is flawed. Hunt for regressions, weak UX,
inconsistent UI, edge cases, duplicate logic, money errors, races, broken
states, mobile and accessibility failures. **Fix meaningful defects — don't
just list them.**

## 12. Git safety

Work on the requested branch/worktree. Never destroy the known-good baseline,
reset production data, rewrite history, or force-push without explicit
instruction. Make coherent commits; never commit with failing tests.

## 13. Completion gate and report

Before calling a major task done, answer honestly:

1. What materially changed, and what user problem does it solve?
2. What behavior was actually tested or observed?
3. What defects did testing reveal, and which were fixed?
4. What remains unresolved?
5. Does the diff justify the claim? — If 1 or 5 is weak, keep working.

Then report briefly — no victory narrative:

- **Implemented** · **Verified (how)** · **Remaining defects** ·
  **Key files** · **Next dependency**
