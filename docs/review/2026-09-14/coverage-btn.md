# تغطية جرد الأزرار (BTN) — ٢٠٢٦-٠٩-١٤ · `375f0d7`

الطريقة: قراءة الملفّ + زحف HTML بخمس جلسات (مالك · محاسب · مشتريات · منتهية · بلا جلسة) لكلّ صفحة + طلب كلّ `href` داخليّ (١٢٨ رابطاً فريداً، كلّها 200 ولا 404 ولا «تعذّر العرض») + إرسال الطلبات الكاتبة بـcurl على `tph_btn` مع عدّ الصفوف قبل وبعد.
الرموز: **ش** قُرئت الشيفرة · **ز** زُحفت بالأدوار · **ط** أُرسل طلبها الكاتب · **—** لا تنطبق.

## الصفحات (`src/app`، غير api)

| الملف | ش | ز | ط | الحكم / المعرّف |
|---|---|---|---|---|
| `page.tsx` (/) | ✓ | ✓ | — | المشتريات → `/upload` · روابط الأرقام: UI-001/002 (غيري) |
| `layout.tsx` · `loading.tsx` · `error.tsx` · `global-error.tsx` · `not-found.tsx` | ✓ | — | — | سليم (زرّ «أعد المحاولة» لم يُفحَص في متصفّح) |
| `login/page.tsx` | ✓ | ✓ | ✗ | زرّ جوجل لم يُضغط (خدمة خارجية) |
| `attention/page.tsx` | ✓ | ✓ | — | BTN-110 · BTN-111 · BTN-112 |
| `audit/page.tsx` · `dashboard/page.tsx` | ✓ | ✓ | — | تحويل دائم يعمل |
| `bank/page.tsx` | ✓ | ✓ | ✓ | BTN-101 · 102 · 103 · 104 · 106 · 113 |
| `review/page.tsx` | ✓ | ✓ | ✓ | الطابور فارغ في اللقطة؛ الأزرار فُحصت بطلباتها |
| `close/page.tsx` | ✓ | ✓ | ✓ | سليم (المنع والإعادة للمالك وحده مُثبَتان) |
| `documents/page.tsx` | ✓ | ✓ | ✓ | **BTN-108** · BTN-109 |
| `money/page.tsx` | ✓ | ✓ | — | FIN-103 (غيري) |
| `money/expenses/page.tsx` | ✓ | ✓ | ✓ | BTN-111 · BTN-114 |
| `money/statement/page.tsx` | ✓ | ✓ | — | لا عنصر تفاعليّ غير القشرة |
| `payments/page.tsx` | ✓ | ✓ | ✓ | **BTN-108** (يظهر فيها) · FIN-101 (غيري) |
| `performance/page.tsx` | ✓ | ✓ | — | سليم |
| `purchases/page.tsx` · `insights/page.tsx` · `invoices/page.tsx` · `products/page.tsx` | ✓ | ✓ | جزئيّ | ai-findings بدور المحاسب ✓ · product لم يُرسَل |
| `analysis/page.tsx` | ✓ | ✓ | — | سليم |
| `review` · `settings/page.tsx` · `settings/audit/page.tsx` | ✓ | ✓ | ✓ | BTN-113 |
| `statements/page.tsx` | ✓ | ✓ | ✗ | «طابِق» يستدعي النموذج — لم يُرسَل |
| `suppliers/page.tsx` · `suppliers/[slug]/page.tsx` | ✓ | ✓ | — | BTN-110 · BTN-032 جزئيّة |
| `upload/page.tsx` | ✓ | ✓ | ✗ | الرفع والمزامنة لم تُرسَل (SEC-102/104/106 عند غيري) |
| كلّ `loading.tsx` (١٤) | ✓ | — | — | هيكلٌ بلا عناصر تفاعليّة |

## المكوّنات (`src/components`، ٣٢) و`lib`

| الملف | ش | ط | ملاحظة |
|---|---|---|---|
| page-shell · nav · user-menu · trial-banner · search-box · hub · figure · changes · scroll-x · page-skeleton · money · ui · ui-client | ✓ | search ✓ | BTN-021 جزئيّة · «خروج» لم يُضغط |
| attention-list | ✓ | — | BTN-110/111/112 |
| bank-import | ✓ | ✗ (bank-rule ✓) | الاستيراد لم يُرسَل بملفّ |
| reconcile-queue · review-workspace · match-explain | ✓ | ✓ | BTN-102/103/104/106 |
| mark-invoice-paid · payment-run-actions | ✓ | ✓ | BTN-105 · FIN-101 |
| month-close | ✓ | ✓ | سليم |
| statement-reconcile | ✓ | ✗ | BTN-029 أُصلحت |
| recurring-expenses · manual-expense · derive-expenses · expense-reclassify | ✓ | record ✓ · counterparty ✓ | BTN-114 · BTN-019 جزئيّة |
| confirm-document · reject-document | ✓ | ✓ | **BTN-108** · BTN-109 |
| uploader · drive-sync · drive-rename | grep للأزرار | supplier ✓ | لم تُقرأ سطراً سطراً |
| product-mapping · ai-analysis | grep للأزرار | ai-findings ✓ | لم تُقرأ سطراً سطراً |
| `lib/nav.ts` · `lib/http-client.ts` · `lib/attention.ts` | ✓ | روابط attention قُورنت أعدادها | BTN-110/111/112 |

## الواجهات (٢٥)

كلّها مجرودة في التقرير (جدول الواجهات). أُرسل طلبٌ حقيقيّ إلى: match-confirm (٤ فروع) · match-confirm-bulk (بالقراءة) · match-undo · mark-paid · counterparty · document-status · month-close · expense-actual · supplier · bank-rule · ai-findings · payment-run · search · health. لم يُرسَل: analyze · archive · bank-import · drive-sync · drive-rename · statement-reconcile · product · expense · ai-analysis · ops/db-identity · auth.

## النسبة
- صفحات: ٢٥/٢٥ قراءةً وزحفاً (١٠٠٪) · روابط داخليّة: ١٢٨/١٢٨ طُلبت.
- مكوّنات: ٣٢/٣٢ جُردت أزرارها؛ ٢٥ قُرئت كاملةً و٧ بـgrep (≈٧٨٪ قراءةً كاملة).
- واجهات: ٢٥/٢٥ جُردت؛ ١٤ أُرسل طلبها (٥٦٪).
