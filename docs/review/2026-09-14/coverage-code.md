# تغطية وكيل الشيفرة (CODE) — ٢٠٢٦-٠٩-١٤ عند `375f0d7`

> مولَّدة من `$SP/code-probe/scan.cjs` ثمّ `coverage.cjs`. الأعمدة آليّة: الأسطر، والصادرات الميّتة، والصادرات التي لا يستوردها إلّا اختبارها، وعدد `as` و`!`. والحكم: رقم ملاحظةٍ، أو «سليم آليّاً» حين لا صادرَ ميّتاً ولا ملفّاً فوق ٤٠٠ سطر ولا ملاحظة.
> «سليم آليّاً» معناه: مرّ على المسح الآليّ وعلى حرّاس التحويل والمعاملة (`tx.cjs`: ٢٢ معاملة، صفر كتابة بـ`db` داخلها، صفر استدعاءٍ لدالّةٍ تكتب بـ`db` بلا مقبض). ولا يعني أنّ منطقه الماليّ رُوجع سطراً سطراً — ذلك عند FIN.

## src/lib (113)

| الملفّ | أسطر | ميّت | للاختبار وحده | as | ! | الحكم |
|---|---:|---:|---:|---:|---:|---|
| `src/lib/ai/deadline.ts` | 34 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/ai/deepseek.ts` | 412 | 1 | 0 | 3 | 0 | OPS-101 (عند غيري) · `contentHash` ميّت · CODE-105 (ميّت: `contentHash`) |
| `src/lib/ai/document-input.ts` | 250 | 0 | 1 | 1 | 2 | سليم آليّاً |
| `src/lib/ai/finding-labels.ts` | 47 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/ai/models.ts` | 124 | 0 | 0 | 1 | 0 | سليم آليّاً |
| `src/lib/ai/pdf-images.ts` | 142 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/ai/supplier-analysis.ts` | 406 | 2 | 1 | 2 | 2 | CODE-105 (ميّت: `FINDING_LABEL`، `SEVERITY_LABEL`) |
| `src/lib/allocation.ts` | 203 | 0 | 0 | 0 | 0 | سليم — مختبَر نقيّاً (`planAllocations`) |
| `src/lib/analytics.ts` | 375 | 1 | 4 | 0 | 4 | CODE-105 (ميّت: `AGE_LABEL`) |
| `src/lib/arabic.ts` | 221 | 1 | 1 | 0 | 0 | CODE-105 (ميّت: `TRANSFER`) |
| `src/lib/archive-import.ts` | 74 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/attention-facts.ts` | 385 | 0 | 0 | 3 | 0 | CODE-104 · CODE-107 |
| `src/lib/attention.ts` | 558 | 0 | 0 | 0 | 2 | CODE-110 · CODE-107 |
| `src/lib/audit.ts` | 104 | 0 | 0 | 3 | 0 | سليم آليّاً |
| `src/lib/bank/adjudicate.ts` | 149 | 1 | 3 | 0 | 0 | CODE-105 (ميّت: `HIGH_VALUE_MINOR`) |
| `src/lib/bank/adjudicator-prompt.ts` | 154 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/bank/adjudicator-provider.ts` | 271 | 0 | 6 | 5 | 0 | CODE-106 (أربعة مزوّدين للاختبار وحده) |
| `src/lib/bank/apply.ts` | 73 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/bank/balance-equation.ts` | 196 | 0 | 3 | 0 | 0 | CODE-106 (`reconcileAccount` للاختبار) |
| `src/lib/bank/candidates.ts` | 420 | 0 | 8 | 0 | 0 | CODE-110 |
| `src/lib/bank/canonical.ts` | 278 | 0 | 4 | 0 | 0 | سليم آليّاً |
| `src/lib/bank/classification.ts` | 319 | 1 | 1 | 0 | 0 | CODE-105 (ميّت: `LAYER_SOURCE`) |
| `src/lib/bank/coverage.ts` | 135 | 0 | 1 | 0 | 0 | سليم آليّاً |
| `src/lib/bank/decision.ts` | 112 | 0 | 4 | 0 | 0 | سليم آليّاً |
| `src/lib/bank/double-paid.ts` | 146 | 0 | 1 | 0 | 0 | سليم آليّاً |
| `src/lib/bank/entities.ts` | 209 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/bank/entity-candidates.ts` | 162 | 0 | 5 | 0 | 0 | CODE-106 (`proposeEntities` للاختبار) |
| `src/lib/bank/evidence-uniqueness.ts` | 50 | 0 | 2 | 0 | 0 | سليم آليّاً |
| `src/lib/bank/fees.ts` | 78 | 0 | 3 | 0 | 0 | CODE-106 (`splitGroupFee` للاختبار) |
| `src/lib/bank/identity.ts` | 88 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/bank/lifecycle.ts` | 109 | 1 | 3 | 0 | 0 | CODE-105 (ميّت: `LIFECYCLE_LABEL`) |
| `src/lib/bank/match.ts` | 252 | 1 | 2 | 0 | 0 | CODE-105 (ميّت: `BankMatch`) |
| `src/lib/bank/metrics.ts` | 164 | 0 | 1 | 0 | 0 | نصٌّ وحده (`db:measure`) — مقصود |
| `src/lib/bank/optimizer.ts` | 252 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/bank/parse.ts` | 335 | 0 | 1 | 0 | 0 | سليم آليّاً |
| `src/lib/bank/parsers/adapters.ts` | 122 | 0 | 2 | 0 | 0 | سليم آليّاً |
| `src/lib/bank/parsers/detect.ts` | 134 | 0 | 1 | 0 | 0 | سليم آليّاً |
| `src/lib/bank/parsers/pdf-text.ts` | 158 | 0 | 0 | 1 | 2 | سليم آليّاً |
| `src/lib/bank/parsers/safe-xlsx.ts` | 142 | 0 | 5 | 5 | 0 | `as unknown as` ×٢ مبرَّر (نزع مفاتيح النموذج الأوّل) |
| `src/lib/bank/pattern.ts` | 213 | 0 | 1 | 0 | 0 | سليم آليّاً |
| `src/lib/bank/pending.ts` | 86 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/bank/pos.ts` | 179 | 0 | 3 | 0 | 0 | سليم آليّاً |
| `src/lib/bank/reason-codes.ts` | 128 | 0 | 1 | 2 | 0 | سليم آليّاً |
| `src/lib/bank/reversal.ts` | 102 | 0 | 4 | 0 | 0 | CODE-106 (اختبارٌ وحده) |
| `src/lib/bank/review-queue.ts` | 133 | 0 | 2 | 0 | 0 | سليم آليّاً |
| `src/lib/bank/rules.ts` | 135 | 1 | 1 | 0 | 0 | CODE-105 (ميّت: `NON_SUPPLIER_CATEGORIES`) |
| `src/lib/bank/statement-balances.ts` | 84 | 0 | 1 | 3 | 0 | سليم آليّاً |
| `src/lib/bank/strength.ts` | 15 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/bank/supplier-profile.ts` | 163 | 0 | 1 | 0 | 1 | سليم آليّاً |
| `src/lib/bank/sync.ts` | 396 | 0 | 2 | 0 | 0 | سليم آليّاً |
| `src/lib/bank/taxonomy.ts` | 102 | 5 | 1 | 0 | 0 | CODE-105 (ميّت: `REVENUE_KINDS`، `POS_COST_KINDS`، `NON_OPERATIONAL`، `OUTCOME_LABEL`، `DISPOSITION_LABEL`) |
| `src/lib/bank/verdict-policy.ts` | 164 | 0 | 4 | 0 | 0 | سليم آليّاً |
| `src/lib/bank/vision-statement.ts` | 233 | 1 | 1 | 0 | 0 | CODE-105 (ميّت: `VISION_PROMPT_VERSION`) |
| `src/lib/canonical-name.ts` | 96 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/cashflow.ts` | 265 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/changes-facts.ts` | 91 | 0 | 0 | 0 | 0 | UI-001 (عند غيري) |
| `src/lib/changes.ts` | 201 | 0 | 3 | 0 | 0 | سليم آليّاً |
| `src/lib/confirm.ts` | 162 | 0 | 0 | 0 | 1 | سليم آليّاً |
| `src/lib/credit-notes.ts` | 87 | 0 | 2 | 0 | 0 | CODE-106 (نصف وصل) |
| `src/lib/data-health-facts.ts` | 44 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/data-health.ts` | 191 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/drive-sync.ts` | 135 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/drive.ts` | 332 | 0 | 0 | 3 | 0 | سليم — `renameFile` يستدعيها `drive-rename` وحده |
| `src/lib/expenses.ts` | 415 | 0 | 3 | 1 | 0 | CODE-110 |
| `src/lib/extraction/benchmark.ts` | 200 | 0 | 5 | 2 | 0 | CODE-106 · CODE-003 قائمة |
| `src/lib/extraction/extract.ts` | 174 | 0 | 0 | 4 | 0 | سليم آليّاً |
| `src/lib/extraction/index.ts` | 58 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/extraction/pipeline.ts` | 285 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/extraction/provider-deepseek.ts` | 310 | 0 | 0 | 1 | 0 | سليم آليّاً |
| `src/lib/extraction/provider-gemini.ts` | 296 | 0 | 1 | 2 | 0 | سليم آليّاً |
| `src/lib/extraction/provider-ollama.ts` | 138 | 0 | 0 | 1 | 0 | سليم آليّاً |
| `src/lib/extraction/provider.ts` | 90 | 0 | 0 | 2 | 0 | سليم آليّاً |
| `src/lib/extraction/schema.ts` | 115 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/extraction/schemas-by-kind.ts` | 231 | 1 | 6 | 2 | 0 | CODE-105 (ميّت: `utilityExtractionSchema`) |
| `src/lib/extraction/statement-extras.ts` | 95 | 0 | 0 | 1 | 0 | سليم آليّاً |
| `src/lib/extraction/validate-extraction.ts` | 242 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/extraction/versions.ts` | 68 | 1 | 0 | 0 | 0 | CODE-105 (ميّت: `provenance`) |
| `src/lib/filing.ts` | 97 | 0 | 1 | 0 | 0 | سليم آليّاً |
| `src/lib/http-client.ts` | 103 | 0 | 0 | 5 | 0 | سليم آليّاً |
| `src/lib/id.ts` | 5 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/invoice-filter.ts` | 108 | 0 | 0 | 2 | 0 | سليم آليّاً |
| `src/lib/issue-codes.ts` | 53 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/items.ts` | 117 | 0 | 2 | 0 | 0 | سليم آليّاً |
| `src/lib/line-pricing.ts` | 195 | 0 | 0 | 1 | 14 | سليم آليّاً |
| `src/lib/money.ts` | 98 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/month-close-facts.ts` | 177 | 0 | 0 | 0 | 0 | CODE-104 |
| `src/lib/month-close.ts` | 283 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/naming.ts` | 295 | 0 | 1 | 0 | 0 | سليم آليّاً |
| `src/lib/nav.ts` | 201 | 0 | 2 | 0 | 0 | سليم آليّاً |
| `src/lib/ops/db-identity.ts` | 134 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/ops/production-gate.ts` | 124 | 0 | 1 | 0 | 0 | CODE-108 (١٦ بنداً والوثيقة ١٥) |
| `src/lib/ops/truth-audit.ts` | 235 | 0 | 1 | 0 | 0 | نصٌّ وحده — مقصود |
| `src/lib/payment-run.ts` | 181 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/payment-state.ts` | 162 | 1 | 5 | 0 | 0 | CODE-105 (ميّت: `OPEN_STATUSES`) |
| `src/lib/permissions.ts` | 113 | 0 | 3 | 0 | 0 | سليم آليّاً |
| `src/lib/preview-mode.ts` | 37 | 0 | 2 | 0 | 0 | سليم آليّاً |
| `src/lib/products.ts` | 147 | 0 | 1 | 0 | 0 | سليم آليّاً |
| `src/lib/provenance-facts.ts` | 250 | 0 | 0 | 0 | 9 | سليم آليّاً |
| `src/lib/provenance.ts` | 96 | 0 | 2 | 0 | 0 | سليم آليّاً |
| `src/lib/rate-limit.ts` | 121 | 0 | 1 | 0 | 0 | سليم آليّاً |
| `src/lib/riyadh-time.ts` | 34 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/sales/connector.ts` | 121 | 0 | 3 | 0 | 0 | سليم آليّاً |
| `src/lib/search.ts` | 175 | 0 | 3 | 0 | 0 | سليم آليّاً |
| `src/lib/session.ts` | 93 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/statement-match.ts` | 384 | 0 | 1 | 0 | 5 | سليم آليّاً |
| `src/lib/supplier-account.ts` | 138 | 0 | 0 | 0 | 1 | سليم آليّاً |
| `src/lib/supplier-balances.ts` | 86 | 0 | 0 | 0 | 0 | سليم — نقيّ ومختبَر |
| `src/lib/supplier-health.ts` | 157 | 0 | 5 | 0 | 0 | سليم آليّاً |
| `src/lib/supplier-match.ts` | 223 | 0 | 1 | 0 | 0 | سليم آليّاً |
| `src/lib/suppliers-seed.ts` | 135 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/lib/token-crypto.ts` | 58 | 0 | 2 | 0 | 0 | سليم — كلّ `setCredentials` يمرّ بـ`openToken` (٤ من ٤) |
| `src/lib/unit-conversion.ts` | 146 | 0 | 6 | 0 | 0 | CODE-106 (اختبارٌ وحده) |
| `src/lib/validation.ts` | 217 | 0 | 2 | 0 | 0 | سليم آليّاً |

## src/services (23)

| الملفّ | أسطر | ميّت | للاختبار وحده | as | ! | الحكم |
|---|---:|---:|---:|---:|---:|---|
| `src/services/adjudicator.service.ts` | 329 | 0 | 1 | 3 | 0 | سليم آليّاً |
| `src/services/bank-account.service.ts` | 91 | 0 | 2 | 0 | 0 | سليم آليّاً |
| `src/services/counterparty.service.ts` | 317 | 0 | 0 | 2 | 0 | CODE-109 (`as EvidenceKind`/`as IdentityKind` — مبرَّران اليوم) |
| `src/services/document.service.ts` | 109 | 0 | 0 | 3 | 0 | سليم آليّاً |
| `src/services/drive.service.ts` | 112 | 0 | 0 | 1 | 0 | سليم آليّاً |
| `src/services/expense.service.ts` | 358 | 1 | 0 | 4 | 0 | CODE-105 (ميّت: `expensesOfMonth`) |
| `src/services/guard.ts` | 46 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/services/invoice.service.ts` | 191 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/services/month-guard.ts` | 31 | 0 | 0 | 0 | 0 | CODE-102 (بلا اختبار قاعدة) |
| `src/services/payment.service.ts` | 403 | 0 | 0 | 0 | 0 | CODE-102 (بلا اختبار قاعدة) |
| `src/services/product.service.ts` | 225 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/services/rate-limit.service.ts` | 73 | 1 | 0 | 0 | 0 | CODE-105 (ميّت: `currentCount`) |
| `src/services/reconcile.service.ts` | 429 | 0 | 0 | 0 | 4 | CODE-110 |
| `src/services/search.service.ts` | 253 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/services/statement-file.service.ts` | 192 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/services/statement-vision.service.ts` | 239 | 0 | 0 | 2 | 0 | CODE-106 (claude/gemini محلّيّان) |
| `src/services/supplier-analysis.service.ts` | 456 | 0 | 0 | 6 | 4 | CODE-110 |
| `src/services/supplier-balance.service.ts` | 95 | 0 | 0 | 0 | 0 | سليم — المصدر الواحد لـ«عليك» |
| `src/services/supplier-credit.service.ts` | 315 | 1 | 0 | 0 | 2 | CODE-102 (بلا اختبار قاعدة) · CODE-105 (`invoiceSupplier` ميّت) |
| `src/services/supplier-profile.service.ts` | 56 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/services/supplier.service.ts` | 165 | 2 | 0 | 0 | 0 | CODE-105 (`learnAlias` و`loadActiveSuppliers` ميّتان) |
| `src/services/types.ts` | 20 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/services/validation.service.ts` | 95 | 0 | 0 | 0 | 2 | سليم آليّاً |

## src/components (33)

| الملفّ | أسطر | ميّت | للاختبار وحده | as | ! | الحكم |
|---|---:|---:|---:|---:|---:|---|
| `src/components/ai-analysis.tsx` | 313 | 0 | 0 | 4 | 0 | سليم آليّاً |
| `src/components/attention-list.tsx` | 149 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/components/bank-import.tsx` | 572 | 0 | 0 | 1 | 0 | CODE-110 |
| `src/components/changes.tsx` | 91 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/components/confirm-document.tsx` | 38 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/components/derive-expenses.tsx` | 53 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/components/drive-rename.tsx` | 227 | 0 | 0 | 3 | 0 | سليم آليّاً |
| `src/components/drive-sync.tsx` | 425 | 0 | 0 | 3 | 0 | CODE-110 |
| `src/components/expense-reclassify.tsx` | 146 | 0 | 0 | 1 | 0 | سليم آليّاً |
| `src/components/figure.tsx` | 139 | 0 | 0 | 0 | 1 | سليم آليّاً |
| `src/components/hub.tsx` | 81 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/components/manual-expense.tsx` | 92 | 0 | 0 | 1 | 0 | سليم آليّاً |
| `src/components/mark-invoice-paid.tsx` | 211 | 0 | 0 | 2 | 0 | سليم آليّاً |
| `src/components/match-explain.tsx` | 191 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/components/money.tsx` | 29 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/components/month-close.tsx` | 328 | 0 | 0 | 1 | 0 | سليم آليّاً |
| `src/components/nav.tsx` | 244 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/components/page-shell.tsx` | 112 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/components/page-skeleton.tsx` | 40 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/components/payment-run-actions.tsx` | 111 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/components/product-mapping.tsx` | 432 | 0 | 0 | 1 | 1 | CODE-110 |
| `src/components/reconcile-queue.tsx` | 426 | 0 | 0 | 0 | 4 | CODE-110 |
| `src/components/recurring-expenses.tsx` | 205 | 0 | 0 | 3 | 0 | سليم آليّاً |
| `src/components/reject-document.tsx` | 47 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/components/review-workspace.tsx` | 647 | 0 | 0 | 0 | 0 | CODE-110 |
| `src/components/scroll-x.tsx` | 81 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/components/search-box.tsx` | 195 | 0 | 0 | 1 | 0 | سليم آليّاً |
| `src/components/statement-reconcile.tsx` | 344 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/components/trial-banner.tsx` | 19 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/components/ui-client.tsx` | 171 | 2 | 0 | 2 | 0 | CODE-105 (ميّت: `StickyActions`، `Progress`) |
| `src/components/ui.tsx` | 392 | 1 | 0 | 0 | 0 | CODE-105 (ميّت: `ErrorState`) |
| `src/components/uploader.tsx` | 800 | 0 | 0 | 3 | 0 | CODE-110 |
| `src/components/user-menu.tsx` | 31 | 0 | 0 | 0 | 0 | سليم آليّاً |

## src/db (2)

| الملفّ | أسطر | ميّت | للاختبار وحده | as | ! | الحكم |
|---|---:|---:|---:|---:|---:|---|
| `src/db/index.ts` | 38 | 0 | 0 | 0 | 0 | سليم آليّاً |
| `src/db/schema.ts` | 1304 | 0 | 0 | 0 | 0 | CODE-106 (`branches`) · CODE-111 |

## ملفّات الاختبار (102) — تصنيف

التصنيف: **نقيّ** (دوالّ بلا إدخال/إخراج) · **محاكاة** (`vi.fn`/`vi.stubGlobal` على حدّ الشبكة) · **حارس نصّيّ** (يقرأ الشيفرة أو الوثيقة) · **يلمس قاعدة**. عدد ما يلمس قاعدة: **صفر**.

| الاختبار | الحالات | التصنيف | يُخدَع؟ / ملاحظة |
|---|---:|---|---|
| `src/lib/ai/deadline.test.ts` | 4 | نقيّ | — |
| `src/lib/ai/deepseek.test.ts` | 18 | محاكاة | حدّ الشبكة مشروع — لا يحاكي المختبَر |
| `src/lib/ai/document-input.test.ts` | 9 | نقيّ | — |
| `src/lib/ai/supplier-analysis.test.ts` | 10 | نقيّ | — |
| `src/lib/allocation-sql.test.ts` | 5 | حارس نصّيّ | جزئيّاً — نافذة ٢٠٠/١٢٠ حرفاً، ويُمسك `${table.col}` بعد `where` وحده |
| `src/lib/allocation.test.ts` | 19 | نقيّ | نقيّ — `planAllocations` لا `allocate` ولا مؤثِّر ٠٢٦ |
| `src/lib/analytics.test.ts` | 35 | نقيّ | — |
| `src/lib/arabic.test.ts` | 10 | نقيّ | — |
| `src/lib/archive-import.test.ts` | 9 | نقيّ | — |
| `src/lib/attention.test.ts` | 35 | نقيّ | — |
| `src/lib/audit.test.ts` | 5 | نقيّ | — |
| `src/lib/bank/adjudicate.test.ts` | 11 | نقيّ | — |
| `src/lib/bank/adjudicator-prompt.test.ts` | 12 | نقيّ | — |
| `src/lib/bank/adjudicator-provider.test.ts` | 13 | محاكاة | حدّ الشبكة — ويختبر ثلاثة مزوّدين لا يُستدعَون (CODE-106) |
| `src/lib/bank/apply.test.ts` | 6 | نقيّ | — |
| `src/lib/bank/balance-equation.test.ts` | 10 | نقيّ | — |
| `src/lib/bank/candidates.test.ts` | 35 | نقيّ | — |
| `src/lib/bank/canonical.test.ts` | 22 | نقيّ | — |
| `src/lib/bank/classification.test.ts` | 36 | نقيّ | — |
| `src/lib/bank/coverage.test.ts` | 12 | نقيّ | — |
| `src/lib/bank/double-paid.test.ts` | 10 | نقيّ | — |
| `src/lib/bank/entities.test.ts` | 14 | نقيّ | — |
| `src/lib/bank/entity-candidates.test.ts` | 13 | نقيّ | — |
| `src/lib/bank/evidence-uniqueness.test.ts` | 5 | نقيّ | — |
| `src/lib/bank/fees.test.ts` | 9 | نقيّ | — |
| `src/lib/bank/identity.test.ts` | 3 | نقيّ | — |
| `src/lib/bank/lifecycle.test.ts` | 11 | نقيّ | — |
| `src/lib/bank/match.test.ts` | 22 | نقيّ | — |
| `src/lib/bank/metrics.test.ts` | 11 | نقيّ | — |
| `src/lib/bank/optimizer.test.ts` | 26 | نقيّ | — |
| `src/lib/bank/parse.test.ts` | 15 | نقيّ | — |
| `src/lib/bank/parsers/adapters.test.ts` | 6 | نقيّ | — |
| `src/lib/bank/parsers/detect.test.ts` | 8 | نقيّ | — |
| `src/lib/bank/parsers/pdf-text.test.ts` | 7 | نقيّ | — |
| `src/lib/bank/parsers/safe-xlsx.test.ts` | 10 | نقيّ | — |
| `src/lib/bank/pattern.test.ts` | 15 | نقيّ | — |
| `src/lib/bank/pos.test.ts` | 14 | نقيّ | — |
| `src/lib/bank/reason-codes.test.ts` | 12 | نقيّ | — |
| `src/lib/bank/reversal.test.ts` | 10 | نقيّ | يختبر وحدةً لا يصل إليها شيء (CODE-106) |
| `src/lib/bank/review-queue.test.ts` | 10 | نقيّ | — |
| `src/lib/bank/rules.test.ts` | 15 | نقيّ | — |
| `src/lib/bank/statement-balances.test.ts` | 4 | نقيّ | — |
| `src/lib/bank/supplier-profile.test.ts` | 10 | نقيّ | — |
| `src/lib/bank/sync.test.ts` | 31 | نقيّ | — |
| `src/lib/bank/verdict-policy.test.ts` | 12 | نقيّ | — |
| `src/lib/bank/vision-statement.test.ts` | 16 | نقيّ | — |
| `src/lib/canonical-name.test.ts` | 8 | نقيّ | — |
| `src/lib/cashflow.test.ts` | 18 | نقيّ | — |
| `src/lib/changes.test.ts` | 15 | نقيّ | — |
| `src/lib/code-guards.test.ts` | 7 | حارس نصّيّ | نعم — CODE-101: الانتظام يرى `async (x) => {` وحده |
| `src/lib/confirm.test.ts` | 13 | نقيّ | — |
| `src/lib/credit-notes.test.ts` | 11 | نقيّ | — |
| `src/lib/data-health.test.ts` | 8 | نقيّ | — |
| `src/lib/docs-claims.test.ts` | 4 | حارس نصّيّ | جزئيّاً — CODE-108: لا يفحص الأعداد (بنود البوّابة، السيناريوهات، الجداول) |
| `src/lib/drive-sync.test.ts` | 4 | نقيّ | نقيّ بعميلٍ مصنوع (`as unknown as`) — مشروع |
| `src/lib/expenses.test.ts` | 53 | نقيّ | — |
| `src/lib/extraction/benchmark.test.ts` | 13 | نقيّ | يختبر وحدةً لا يستعملها نصّ القياس (CODE-003) |
| `src/lib/extraction/calendar-date.test.ts` | 2 | نقيّ | — |
| `src/lib/extraction/pipeline.test.ts` | 21 | نقيّ | — |
| `src/lib/extraction/provider-parity.test.ts` | 4 | نقيّ | — |
| `src/lib/extraction/provider.test.ts` | 20 | محاكاة | حدّ الشبكة مشروع |
| `src/lib/extraction/schemas-by-kind.test.ts` | 17 | نقيّ | — |
| `src/lib/extraction/statement-extras.test.ts` | 6 | نقيّ | — |
| `src/lib/extraction/validate-extraction.test.ts` | 18 | نقيّ | — |
| `src/lib/filing.test.ts` | 10 | نقيّ | — |
| `src/lib/invoice-filter.test.ts` | 11 | نقيّ | — |
| `src/lib/items.test.ts` | 17 | نقيّ | — |
| `src/lib/line-pricing.test.ts` | 19 | نقيّ | — |
| `src/lib/money.rounding.test.ts` | 5 | نقيّ | — |
| `src/lib/money.test.ts` | 8 | نقيّ | — |
| `src/lib/month-close.test.ts` | 24 | نقيّ | نقيّ — الموانع لا `month-guard` ولا مؤثِّرات ٠٢٨ |
| `src/lib/naming.test.ts` | 27 | نقيّ | — |
| `src/lib/nav.test.ts` | 21 | نقيّ | — |
| `src/lib/ops/db-identity.test.ts` | 13 | نقيّ | — |
| `src/lib/ops/production-gate.test.ts` | 7 | نقيّ | — |
| `src/lib/ops/truth-audit.test.ts` | 15 | نقيّ | — |
| `src/lib/payment-run.test.ts` | 17 | نقيّ | — |
| `src/lib/payment-state.test.ts` | 21 | نقيّ | — |
| `src/lib/permissions.test.ts` | 9 | نقيّ | — |
| `src/lib/permissions.writes.test.ts` | 4 | نقيّ | — |
| `src/lib/preview-mode.test.ts` | 10 | نقيّ | — |
| `src/lib/products.test.ts` | 12 | نقيّ | — |
| `src/lib/provenance.test.ts` | 11 | نقيّ | — |
| `src/lib/rate-limit.test.ts` | 10 | نقيّ | — |
| `src/lib/riyadh-time.test.ts` | 2 | نقيّ | — |
| `src/lib/sales/connector.test.ts` | 5 | نقيّ | — |
| `src/lib/search.test.ts` | 26 | نقيّ | — |
| `src/lib/statement-match.test.ts` | 26 | نقيّ | — |
| `src/lib/supplier-account.test.ts` | 13 | نقيّ | — |
| `src/lib/supplier-balances.test.ts` | 4 | نقيّ | نقيّ — الدالّة لا الاستعلام في `supplier-balance.service.ts` |
| `src/lib/supplier-health.test.ts` | 21 | نقيّ | — |
| `src/lib/supplier-match.test.ts` | 21 | نقيّ | — |
| `src/lib/suppliers-seed.test.ts` | 9 | نقيّ | — |
| `src/lib/token-crypto.test.ts` | 5 | نقيّ | — |
| `src/lib/ui-terms.test.ts` | 2 | حارس نصّيّ | نعم — CODE-107: `.tsx` وحده وثمانية أسماء، و٢٥ عدداً في `.ts` خارجه |
| `src/lib/unit-conversion.test.ts` | 13 | نقيّ | يختبر وحدةً لا يصل إليها شيء (CODE-106) |
| `src/lib/validation.test.ts` | 20 | نقيّ | — |
| `src/services/adjudicator.service.test.ts` | 12 | محاكاة | مزوّدٌ محقون بـ`vi.fn` — يختبر السياسة لا النداء |
| `src/services/bank-account.service.test.ts` | 5 | نقيّ | نقيّ — التوحيد وحده |
| `src/services/counterparty.service.test.ts` | 9 | نقيّ | نقيّ على دوالّ الخدمة الصرفة — لا `confirmCounterparty` بقاعدة |
| `src/services/reconcile-matrix.test.ts` | 22 | نقيّ | نقيّ — مصفوفة حالات |
| `src/services/reconcile.service.test.ts` | 24 | نقيّ | نقيّ — المحرّك بمدخلاتٍ مصنوعة، لا الجسر مع القاعدة |

**المجموع:** 273 بنداً، المحكوم عليه 273 (١٠٠٪).
