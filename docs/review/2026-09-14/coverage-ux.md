# تغطية مراجعة الواجهة (UX) — ١٤–١٥ سبتمبر ٢٠٢٦

المرجع: `main` عند `375f0d7`. الخادم: `next start` على `127.0.0.1:3800` بقاعدة `tph_code` (قراءة فقط)، جلستا المالك والمشتريات.
الأدوات (في `$SP/ux-probe/`): `colors.mjs` (رموز globals.css + أصناف الألوان في كلّ `.tsx`)، `html-audit.mjs` (تباينٌ بالتعشيش الفعليّ في HTML المُصيَّر + الأرقام + التواريخ + تمييز العدد + الحقول)، `acts.mjs` (جرد الأزرار والروابط)، ومسحٌ للحقول (`label`/`aria-label`/`inputMode`).
HTML المُصيَّر: ٢٦ مساراً للمالك (`html/`) و١٩ للمشتريات (`html-p/`).

**نسبة التغطية: ١٠٠٪ من الملفّات المطلوبة (٤٥ صفحة/تخطيط/حالة + ٣٢ مكوّناً + ٤ ملفّات مكتبة/نمط).**
«رُوجع» تعني: مُسح آليّاً بالأدوات الأربع (الألوان والأرقام والحقول والأصناف الفيزيائيّة والأسهم) **و**قُرئ الموضع الذي ظهر فيه أثر. الحكم «سليم» يعني أنّ الأدوات لم تجد فيه شيئاً في نطاق «ط»، لا أنّه قُرئ سطراً سطراً.

## الصفحات (`src/app/**/page.tsx` و`layout.tsx` وحالاتها)
| الملفّ | HTML مُصيَّر؟ | الحكم |
|---|---|---|
| `layout.tsx` | نعم (كلّ الصفحات) | سليم — `lang="ar" dir="rtl"` |
| `page.tsx` (`/`) | نعم | UX-104، UX-106، UX-109؛ وعند المنسّق UI-001..004 |
| `attention/page.tsx` | نعم | UX-104، UX-105 |
| `audit/page.tsx` و`dashboard/page.tsx` | نعم (تحويل) | سليم — تحويلٌ دائم |
| `bank/page.tsx` | نعم | UX-107، UX-108، UX-110 |
| `close/page.tsx` | نعم | UX-103 (عبر `month-close.tsx`)، UX-110 |
| `documents/page.tsx` | نعم | UX-110؛ عند المنسّق UI-006 |
| `error.tsx` · `global-error.tsx` · `not-found.tsx` | نعم (404) | سليم — UX-013 القديمة أُصلحت |
| `loading.tsx` (١٦ ملفّاً) | نعم (مضمَّنة في البثّ) | UX-112 (`money/loading` يسمّي «كشف الحساب» «المال») |
| `login/page.tsx` | نعم | سليم |
| `money/page.tsx` | نعم | UX-101 (الخريطة) |
| `money/expenses/page.tsx` | نعم | UX-110 |
| `money/statement/page.tsx` | نعم | UX-112 |
| `payments/page.tsx` | نعم | UX-110 (UX-031 القديمة) |
| `performance/page.tsx` | نعم | UX-101 |
| `purchases/page.tsx` | نعم | UX-105 (`toLocaleString`) |
| `purchases/insights/page.tsx` | نعم | UX-101، UX-102 |
| `purchases/invoices/page.tsx` | نعم | UX-110 |
| `purchases/products/page.tsx` | نعم | UX-103 |
| `analysis/page.tsx` | نعم | UX-101 |
| `review/page.tsx` | نعم (المحتوى في مكوّن عميل) | سليم في «ط» عدا ما في مكوّناته |
| `settings/page.tsx` | نعم | سليم (UX-017 القديمة أُصلحت) |
| `settings/audit/page.tsx` | نعم | UX-108، UX-111 |
| `statements/page.tsx` | نعم | UX-103 (عبر `statement-reconcile.tsx`) |
| `suppliers/page.tsx` | نعم | SCN-105 عند غيري |
| `suppliers/[slug]/page.tsx` | نعم (`GoldenCup`) | UX-110 |
| `upload/page.tsx` | نعم | BTN-116 عند غيري |

## المكوّنات (`src/components/**`)
| الملفّ | الحكم |
|---|---|
| `ai-analysis.tsx` | UX-105 (`${count} اقتراح`)، UX-109 |
| `attention-list.tsx` | سليم (التباين ≥ ٨٫٣٦ مع `opacity-70`) |
| `bank-import.tsx` | UX-103 (حقلان وقائمتان بلا اسم)، UX-105 |
| `changes.tsx` | عند المنسّق UI-002/003 |
| `confirm-document.tsx` · `reject-document.tsx` | سليم |
| `derive-expenses.tsx` | UX-113 (هدف لمس) |
| `drive-rename.tsx` | سليم |
| `drive-sync.tsx` | UX-105 (`عرض سعر`) |
| `expense-reclassify.tsx` | UX-113 |
| `figure.tsx` | سليم |
| `hub.tsx` | سليم (UX-017 أُصلحت: حدٌّ متقطّع بلا شفافيّة) |
| `manual-expense.tsx` | سليم (`aria-label` و`inputMode`) |
| `mark-invoice-paid.tsx` | UX-109؛ BTN-027 عند غيري |
| `match-explain.tsx` | UX-107؛ UI-005 عند المنسّق |
| `money.tsx` | سليم |
| `month-close.tsx` | UX-103 (قائمة الشهر وحقل السبب) |
| `nav.tsx` | UX-101، UX-112 |
| `page-shell.tsx` · `page-skeleton.tsx` · `trial-banner.tsx` · `user-menu.tsx` | سليم |
| `payment-run-actions.tsx` | سليم |
| `product-mapping.tsx` | UX-103 |
| `reconcile-queue.tsx` | سليم في «ط» (الحقول ملفوفة بـ`label`) |
| `recurring-expenses.tsx` | سليم (UX-030 أُصلحت) |
| `review-workspace.tsx` | UX-109 |
| `scroll-x.tsx` | سليم |
| `search-box.tsx` | سليم (UX-029 أُصلحت: `combobox`/`listbox`) |
| `statement-reconcile.tsx` | UX-103، UX-113 |
| `ui-client.tsx` · `ui.tsx` | UX-114 (حدود الحقول ١٫٢٧:١)؛ الجدول يصير بطاقات ✓ |
| `uploader.tsx` | UX-103، UX-115 |

## الأنماط والمكتبات
| الملفّ | الحكم |
|---|---|
| `src/app/globals.css` | التباين محسوباً لكلّ الرموز (الجدول ١ في findings-ux.md)؛ UX-114؛ `--ring` ≥ ٣:١ ✓ |
| `src/app/fonts.ts` | سليم |
| `src/lib/arabic.ts` | سليم في ذاته؛ المخالفات في مستدعيه (UX-104، UX-105) |
| `src/lib/nav.ts` | UX-101، UX-112 |

## ما لم يُغطَّ من «ط» ولماذا
- **حالات العميل بعد التفاعل** (معاينة الرفع، نتيجة الاستيراد، أخطاء الطلب) لا تظهر في HTML المُصيَّر؛ فُحصت من الشيفرة وحدها.
- **أهداف اللمس بالبكسل** والتمرير الأفقيّ: قاسها المنسّق (`findings-browser.md`)؛ هنا الموضع في الشيفرة وحده (UX-113).
- **قارئ شاشة حقيقيّ** (VoiceOver/TalkBack): لم يُشغَّل.
