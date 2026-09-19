# تغطية مراجعة الأمن (SEC) — ١٤ سبتمبر ٢٠٢٦ — `main` عند `375f0d7`

**البيئة:**
- بناءٌ إنتاجيّ (`next start`، `NODE_ENV=production`) على `127.0.0.1:3400` فوق `tph_sec`. أثبتت `/api/ops/db-identity` أنّ `systemIdentifier` هو المعرّف المحلّيّ.
- ثلاثة خوادم تجاوز مؤقّتة: 3401 و3402 و3403. أُوقفت كلّها.
- الملاحظات نفسها في ردّ الوكيل، لأنّ كتابة `findings-sec.md` رُفضت للوكيل الفرعيّ.

**التغطية:**
- **‏١٠٠٪ من البنود المطلوبة (٤٤ بنداً):** ٢٥ ملفّ `route.ts`، و١٩ ملفّاً وبنداً آخر.
- **‏٢٤ واجهة × ٦ هويّات ضُربت فعلاً** (المصفوفة في الملاحظات)، ومعها `auth/*`.
- **ما لم يُشغَّل:**
  - إعادة التوجيه الخارجيّ بعد الدخول: الجدار يحجب اكتشاف جوجل، فكلّ `signin/google` يعود بـ`Configuration`. **مُتتبَّع لا مُثبَت.**
  - تعطيل المؤثِّر بدور `neondb_owner` نفسه: الدور المحلّيّ superuser.

| البند | قُرئ | شُغِّل | الحكم |
|---|---|---|---|
| `api/ai-analysis` | كاملاً | مصفوفة | SEC-101 (مرّ للمعطَّل) · وإلّا سليم |
| `api/ai-findings` | كاملاً | مصفوفة | سليم: `payment:approve` لما يكتب مالاً |
| `api/analyze` | كاملاً | مصفوفة · ٦ م.ب ← 400 · حقن | SEC-107 · الحدّ والنوع سليمان |
| `api/archive` | كاملاً | مصفوفة · مشتريات ١٠٠٬٠٠٠ ر.س · إجماليّ صفر | SEC-102 · SEC-106 · البايتات السحرية و`SAFE_NAME` سليمة |
| `api/auth/[...nextauth]` | كاملاً | csrf · خروج · خروج بلا رمز | سليم: الخروج يحذف الصفّ، والرمز القديم ← 401، وبلا csrf ← `MissingCSRF` |
| `api/bank-import` | `:20-140` و`:880-912` | مصفوفة | سليم: `bank:edit` وحدّ ٤ م.ب |
| `api/bank-rule` | كاملاً | مصفوفة | SEC-109 (بلا حدّ طول) |
| `api/counterparty` | كاملاً | مصفوفة | سليم (SEC-008 أُصلحت) |
| `api/document-status` | كاملاً | مصفوفة | سليم: التأكيد يحتاج `amounts:view` |
| `api/drive-rename` | كاملاً | مصفوفة · معرّفات مجهولة و`../` ← ٠ تسمية وصفر نداء كتابة | SEC-104 · اشتقاق الاسم في الخادم سليم |
| `api/drive-sync` | `:1-140` | مصفوفة · 3403 | SEC-103 |
| `api/expense-actual` | كاملاً | مصفوفة | سليم |
| `api/expense` | كاملاً | مصفوفة · SEC-101 · مبالغ حدّية · CSRF | SEC-108 · SEC-109 |
| `api/health` | كاملاً | مصفوفة | سليم: غير المخوَّل يرى `healthy` وحده |
| `api/mark-paid` | كاملاً | مصفوفة · معرّفات غير نصّية ← 200 بلا كتابة | سليم |
| `api/match-confirm-bulk` | كاملاً | مصفوفة · معرّفات غير نصّية | سليم |
| `api/match-confirm` | `:60-280` | مصفوفة | سليم: `payment:approve` |
| `api/match-undo` | كاملاً | مصفوفة | سليم (SEC-015 أُصلحت) |
| `api/month-close` | كاملاً | مصفوفة | سليم: إعادة الفتح للمالك |
| `api/ops/db-identity` | كاملاً | مصفوفة · ٣٣ طلباً ← 429 | سليم |
| `api/payment-run` | كاملاً | مصفوفة · ظهرت فاتورة SEC-102 | SEC-102 |
| `api/product` | كاملاً | مصفوفة | سليم |
| `api/search` | كاملاً | ٤ استعلامات للمشتريات | SEC-105 (SEC-005 أُصلحت) |
| `api/statement-reconcile` | `:1-140` | مصفوفة | SEC-103 (مُتتبَّع) |
| `api/supplier` | كاملاً | مصفوفة | سليم |
| `src/proxy.ts` | كاملاً | مصفوفة · 3401 و3402 | سليم |
| `src/auth.ts` | كاملاً | SEC-101 · خروج | SEC-101 · النطاق `drive` كامل (SEC-011) |
| `src/instrumentation.ts` | كاملاً | سجلّ 500 | SEC-110 |
| `src/lib/session.ts` | كاملاً | SEC-101 | SEC-101 |
| `src/lib/permissions.ts` | كاملاً | مصفوفة | سليم: الردود تطابق الجدول |
| `src/lib/preview-mode.ts` | كاملاً | 3401 (prod) ← 401 · 3402 (`VERCEL_ENV=preview`) ← 401 · 3403 (`NODE_ENV=development`) ← مفتوح | سليم في البناء الإنتاجيّ · SEC-103 |
| `src/lib/token-crypto.ts` | كاملاً | tsx: ذهاب وإياب، وIV عشوائيّ، ورفض العبث، ورفض المفتاح الخطأ | سليم · والتفعيل مشروط بمفتاح (SEC-011 جزئيّة) |
| `src/lib/http-client.ts` | كاملاً | — | سليم |
| `src/lib/code-guards.test.ts` | كاملاً | — | سليم |
| `src/services/guard.ts` | كاملاً | مصفوفة | سليم |
| `src/services/rate-limit.service.ts` + `src/lib/rate-limit.ts` | كاملاً | 429 مع `retry-after: 821` | سليم (العدّ قبل التحقّق من الجسم) |
| `src/lib/audit.ts` | كاملاً | — | SEC-007 جزئيّة |
| `next.config.ts` | كاملاً | `curl -I` على صفحة وواجهة | سليم: الستّ كلّها. وبقي `X-Powered-By: Next.js` (P3 تلميع) |
| `drizzle/sql/001` | كاملاً | UPDATE/DELETE/TRUNCATE مرفوضة · `DISABLE TRIGGER USER` ثمّ DELETE ← **مقبول** (أُلغي) | SEC-001 قائمة. أُثبت بـsuperuser، والمالك في الإنتاج يملك الأمر نفسه (مُتتبَّع) |
| `drizzle/sql/004` | كاملاً | — | سليم |
| `src/app/login/page.tsx` | كاملاً | — | `redirectTo: from` يمرّ بدالّة إعادة التوجيه الافتراضيّة في Auth.js (نفس الأصل). **لم يُشغَّل** |
| `src/components/user-menu.tsx` | كاملاً | خروج عبر `/api/auth/signout` | سليم |
| `SECURITY.md` | كاملاً | — | §٤ يطابق الواقع · §٣·١ مشروطٌ بمفتاحٍ لا يُعرَف أضُبط |
| SQL الخامّ | فحصٌ متعدّد الأسطر لكلّ `sql\`` | — | سليم: `sql.raw` بثابتٍ واحد (`purchases/invoices:75`)، والاستعلامات المرتبطة تكتب `${issues}.entity_id` أو قيماً. لا مصيدة |
| `.next/static` (١٫٦ م.ب) و`NEXT_PUBLIC_` | grep | — | سليم: صفر |
| `.claude/launch.json` | كاملاً | — | SEC-002: صار `-H 127.0.0.1` |
