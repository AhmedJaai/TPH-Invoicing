# تغطية مراجعة التشغيل (OPS) — ١٤–١٥ سبتمبر ٢٠٢٦

> «رُوجع» لا يُملأ إلّا بدليل: رقم ملاحظة، أو «سليم» مع سببه. المعرّفات OPS-1xx في تقرير الوكيل (يكتبه المنسّق في `findings-ops.md`).

## الإعداد والبنية

| الملفّ | رُوجع؟ |
|---|---|
| `src/db/index.ts` | نعم — `max: isServerless?1:10`، مهلات 10s اتصالاً و30s استعلاماً؛ الـpooler يُفرض بالوثيقة لا بالشيفرة (OPS-108) |
| `src/instrumentation.ts` | نعم — `console.error` وحده، لا تنبيه (OPS-105)؛ تسجيل params ⟵ SEC-110 |
| `next.config.ts` | سليم — `serverExternalPackages` وترويسات أمان؛ لا `cacheComponents` |
| `package.json` | نعم — ٩ أوامر غير مذكورة في CLAUDE.md (OPS-110)؛ كلّها `--env-file=.env` (OPS-106) |
| `drizzle.config.ts` | سليم — لا يُستعمَل للدفع؛ يقرأ `.env` |
| `vitest.config.mts` | سليم في ذاته — `src/**/*.test.ts` بيئة node، لا اختبار يلمس قاعدة (مذكور في CLAUDE.md) |
| `.claude/launch.json` | نعم — OPS-106 |
| `ops-attestation.example.json` | نعم — لا `ops-attestation.json` حقيقيّ (OPS-107) |
| `docs/SETUP.md` | نعم — لا إجراء نسخٍ ولا استعادة (OPS-103)؛ يقرّ النشر اليدويّ وHobby |
| `src/config/drive.ts` | سليم — ثوابت معرّفات المجلّدات والشركة من البيئة |
| `.github/workflows/ci.yml` | سليم — typecheck/lint/test/build؛ النشر لا ينتظره (OPS-106) |

## الذكاء والاستخراج

| الملفّ | رُوجع؟ |
|---|---|
| `src/lib/ai/deepseek.ts` | نعم — OPS-101 (إشارة تنقضي مرّة ثمّ محاولتان بلا إلغاء)؛ OPS-109 (السبب الحقيقيّ يضيع) |
| `src/lib/ai/deadline.ts` | سليم — مُثبَت على المسار: analyze وstatement-reconcile يقفان عند 52s |
| `src/lib/ai/models.ts` | نعم — لا `-exp`؛ ٤٠٤ يُعلَن «غير متاح لهذا المفتاح» (مُثبَت)؛ الصحّة لا تفحص الاسم (OPS-105) |
| `src/lib/ai/document-input.ts` | سليم — نصّ أوّلاً (مُثبَت: PDF بلا `raw_text` قُرئ نصّاً)، ثمّ صورة |
| `src/lib/ai/pdf-images.ts` | سليم — كشف AVAL الممسوح أُرسل صورةً 164KB |
| `src/lib/ai/supplier-analysis.ts` | سليم تشغيليّاً — الحساب قبل النموذج |
| `src/lib/ai/finding-labels.ts` | سليم — تسميات عرض |
| `src/lib/extraction/provider-deepseek.ts` | نعم — مرحلتان؛ على 503 ستّة نداءات للمستند (مُثبَت)؛ OPS-109 |
| `src/lib/extraction/index.ts` · `extract.ts` · `provider.ts` · `schema.ts` · `schemas-by-kind.ts` · `validate-extraction.ts` · `statement-extras.ts` · `pipeline.ts` · `versions.ts` | سليم تشغيليّاً — لا نداء شبكة خارج `callDeepseek` |
| `src/lib/extraction/provider-gemini.ts` · `provider-ollama.ts` | سليم — خاملان خلف `EXTRACTION_ALLOW_ALT_PROVIDER` |
| `src/lib/extraction/benchmark.ts` | سليم — لا تصل إليه شاشة (موثَّق) |
| `src/services/supplier-analysis.service.ts` | نعم — OPS-101 (144s مُثبَتة)؛ لا اتّصال قاعدة محتجز أثناء النداء (مُثبَت) |
| `src/services/adjudicator.service.ts` | نعم — حتى 25 نداءً متسلسلاً تحت `withDeadline`؛ الكتابة بعدها بلا ميزانيّة (OPS-104) |

## الدرايف والعمليّات

| الملفّ | رُوجع؟ |
|---|---|
| `src/lib/drive.ts` | نعم — `googleapis` بلا مهلة صريحة؛ `renameFile` مستدعٍ واحد (حارس نصّيّ) |
| `src/lib/drive-sync.ts` | سليم — `deadline` يُفحَص عند رأس كلّ شهر |
| `src/app/api/drive-sync/route.ts` | نعم — ميزانيّات 20s/28s + 55s؛ لا تسمية (OPS-007 أُصلحت) |
| `src/app/api/drive-rename/route.ts` | مشتبَه S-2 — 25 تسمية بلا ميزانيّة |
| `src/services/drive.service.ts` | نعم — الرفع قبل القيد ⟵ SEC-106 |
| `src/lib/ops/production-gate.ts` | سليم — `buildGate` يُسقط الغائب إلى `UNKNOWN` |
| `src/lib/ops/db-identity.ts` | سليم |
| `src/lib/ops/truth-audit.ts` | سليم — دوالّ خالصة |
| `src/app/api/health/route.ts` | نعم — OPS-105 (HTTP 200 مع `healthy:false`، مُثبَت) |

## النصوص (`scripts/`، ٤١ ملفّاً + `lib/guard-write.ts`)

| النصّ | النوع | الحارس | package.json | شُغّل؟ |
|---|---|---|---|---|
| `audit-data.ts` | يقرأ | — | db:audit | نعم ✓ (1s) |
| `backfill-content.ts` | يكتب القاعدة، يقرأ الدرايف | `--commit` بلا guard-write | drive:backfill | لا (يكتب) — OPS-102 |
| `backfill-missing-invoices.ts` | يكتب | `--apply` بلا guard-write | db:backfill-invoices | لا — OPS-102 |
| `benchmark-providers.ts` | يقرأ + ذكاء | — | bench:extraction | لا (ذكاء) |
| `bootstrap-schema.ts` | يكتب المخطّط | يرفض قاعدةً فيها جداول | db:bootstrap | لا |
| `build-products.ts` | يكتب | guard-write ✓ | db:products | لا |
| `certify-flow.ts` | يكتب ثمّ يحذف + يكتب `certify-result.json` | — | ops:certify | لا ⟵ مثبَت عند غيري |
| `certify-real-bank.ts` | يقرأ | — | ops:real-bank | لا |
| `check-isolation.ts` | يقرأ | — | ops:isolation | نعم ✓ |
| `dedupe-bank.ts` | يحذف | `apply` بلا guard-write | db:dedupe | لا — OPS-102 |
| `derive-expenses.ts` | يكتب | guard-write ✓ | db:expenses | لا |
| `diagnose-drive.ts` | يقرأ الدرايف | — | drive:diagnose | لا |
| `diagnose-unpaid.ts` | يقرأ | — | db:unpaid | نعم ✓ (1s) |
| `drive-auth.ts` | OAuth محلّيّ | — | drive:auth | لا |
| `drive-inventory.ts` | يقرأ الدرايف | — | drive:inventory | لا |
| `find-split-suppliers.ts` | يقرأ | — | db:split-check | نعم ✓ |
| `identity-report.ts` | يقرأ؛ `apply` يكتب | بلا guard-write | db:identity | رُفض التشغيل من المصنِّف |
| `learn-counterparties.ts` | يكتب/يحذف | `apply` بلا guard-write | db:learn | لا — OPS-102 |
| `link-counterparties.ts` | يقرأ (لا كتابة ظاهرة) | — | db:link | رُفض التشغيل |
| `measure-system.ts` | يقرأ | — | db:measure | نعم ✓ |
| `merge-suppliers.ts` | يكتب | `--commit` بلا guard-write | db:merge | لا — OPS-102 |
| `migrate-archive.ts` | يكتب | `--commit` بلا guard-write | drive:migrate | لا — OPS-102 |
| `migrate.ts` | يكتب المخطّط | قفل استشاريّ + `--reapply` | db:migrate | رُفض التشغيل؛ مُتتبَّع (OPS-011 أُصلحت) |
| `missing-invoices.ts` | يقرأ | — | db:missing-invoices | رُفض التشغيل |
| `production-gate.ts` | يقرأ | — | ops:gate | نعم ✓ |
| `reclassify-bank.ts` | يكتب | `apply` بلا guard-write | db:reclassify | لا — OPS-102 |
| `recompute-line-pricing.ts` | يكتب | `--commit` بلا guard-write | db:reprice | لا — OPS-102 |
| `rematch-bank.ts` | يكتب | `apply` بلا guard-write | db:rematch | لا — OPS-102 |
| `remove-duplicate-transaction.ts` | يحذف | `--apply` بلا guard-write | db:remove-dupe | لا — OPS-102 |
| `repair-bank-rules.ts` | يحذف | `--commit` بلا guard-write | db:repair-rules | لا — OPS-102 |
| `repair-import-scope.ts` | يحذف | `apply` بلا guard-write | db:repair-scope | لا — OPS-102 |
| `repair-integrity.ts` | يكتب/يحذف | `--commit` بلا guard-write | db:repair | لا — OPS-102 |
| `repair-period-month.ts` | يكتب | `--apply` بلا guard-write | db:repair-months | لا — OPS-102 |
| `seed-demo.ts` | يكتب | guard-write ✓ | db:demo | لا |
| `seed-suppliers.ts` | يكتب | guard-write ✓ | db:seed | لا |
| `truth-audit.ts` | يقرأ الدرايف + يكتب `truth-audit.json` | — | ops:truth | لا |
| `try-archive.ts` | يكتب الدرايف بـ`--upload` | guard-write ✓ | try:archive | لا |
| `try-bank.ts` · `try-extract.ts` · `try-statement.ts` | يقرأ + ذكاء | — | try:* | لا |
| `verify-invariants.ts` | يكتب داخل معاملة تُلغى | — | db:verify | رُفض التشغيل؛ مُتتبَّع |
| `lib/guard-write.ts` | الحارس | — | — | نعم — مستعمَل في ٥ نصوص من ~١٩ كاتبة |

## التجارب الحيّة

| البند | النتيجة |
|---|---|
| مهلات analyze / statement-reconcile / ai-analysis بذكاءٍ متأخّر 70s | 52.08s / 52.07s / **144.2s** |
| `pg_stat_activity` أثناء الانتظار | لا `idle in transaction`، ولا اتّصال محجوز |
| استيراد كشف الأهلي الحقيقيّ ثانيةً | 0.22s، 20 استعلاماً، 0 نداء ذكاء، 0 إضافة |
| استيراد 1436 صفّاً جديداً (تواريخ مُزاحة) | 0.59s محلّياً، **2775 استعلاماً** في معاملة واحدة، 1318 أُدرجت و118 ردّها قيد المرجع؛ الإعادة 139 استعلاماً و0 تكرار |
| استعادة النسخة `full/` في `tph_restore` | 51/51 جدولاً تطابق البصمة؛ مؤثِّرات 7، قيود 691، فهارس 164، دوالّ 44 = `tph_ops` — **بشرط** `set check_function_bodies = off` |
| الصفحات الثقيلة (١٢) | 4–23 استعلاماً، 12–40ms محلّياً |
| ٥ مستندات إلى `/api/analyze` | 6 نداءات للمستند على 503؛ 409 بلا نداء للمرفوع؛ 404 ← نداءان ورسالة واضحة |

## ما لم يُفحَص
- مسار الذكاء الناجح بكلفته الفعليّة (المزيَّف لم يُطابق نصّ الملفّات بعد إلحاق بايت، فردّ 503).
- `/api/drive-sync` حيّاً على نسخة الأرشيف (لا ملفّ PDF خارج القاعدة؛ الجديد ٩٧ ملفّاً نصّيّاً).
- زمن الرحلة إلى Neon من Vercel، وإعداد Fluid/المنطقة/الخطّة (يحتاج لوحة Vercel).
- `migrate.ts` و`verify-invariants.ts` و`identity-report.ts` تشغيلاً (رفضها مصنِّف الأدوات).
