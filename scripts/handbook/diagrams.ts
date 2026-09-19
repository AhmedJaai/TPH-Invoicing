/**
 * مخطّطاتُ الدليل — SVG مكتوبٌ بيد، لا مكتبةَ رسم.
 *
 * ولا يُستعمَل Mermaid ولا غيرُه: الدليلُ يُطبَع في متصفّحٍ بلا شبكة،
 * ومكتبةٌ تُحمَّل من CDN تُنتج صفحةً فارغة في PDF بلا أن يُقال لِمَ.
 * والـSVG المكتوب يُرسَم كما هو في كلّ حال.
 *
 * والاتّجاه من اليمين إلى اليسار في كلّ ما فيه نصٌّ عربيّ.
 */

const C = {
  ink: "#111827",
  soft: "#4b5563",
  line: "#d1d5db",
  fill: "#f9fafb",
  accent: "#1d4ed8",
  warn: "#b45309",
  ok: "#047857",
  danger: "#b91c1c",
};

function box(
  x: number, y: number, w: number, h: number,
  title: string, sub = "", tone: keyof typeof C = "line",
): string {
  const stroke = C[tone] ?? C.line;
  return `
    <g>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8"
            fill="${C.fill}" stroke="${stroke}" stroke-width="1.5"/>
      <text x="${x + w / 2}" y="${y + (sub ? h / 2 - 4 : h / 2 + 5)}"
            text-anchor="middle" font-size="13" font-weight="700" fill="${C.ink}">${title}</text>
      ${sub ? `<text x="${x + w / 2}" y="${y + h / 2 + 14}" text-anchor="middle" font-size="11" fill="${C.soft}">${sub}</text>` : ""}
    </g>`;
}

function arrow(x1: number, y1: number, x2: number, y2: number, label = ""): string {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  return `
    <g>
      <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${C.soft}" stroke-width="1.4" marker-end="url(#a)"/>
      ${label ? `<text x="${mx}" y="${my - 6}" text-anchor="middle" font-size="10.5" fill="${C.soft}">${label}</text>` : ""}
    </g>`;
}

const defs = `
  <defs>
    <marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="${C.soft}"/>
    </marker>
  </defs>`;

const svg = (w: number, h: number, body: string) =>
  `<svg viewBox="0 0 ${w} ${h}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="system-ui, sans-serif" direction="rtl">${defs}${body}</svg>`;

/** ١ · طبقاتُ النظام — من المتصفّح إلى القاعدة. */
export const layers = svg(820, 430, `
  ${box(510, 20, 280, 52, "المتصفّح", "مكوّنات عميل · 34 ملفّاً", "accent")}
  ${arrow(650, 72, 650, 100, "طلب")}
  ${box(510, 100, 280, 52, "قشرة الصفحة", "PageShell · Sidebar · AreaTabs")}
  ${arrow(650, 152, 650, 180)}
  ${box(430, 180, 360, 52, "مكوّنات الخادم (صفحات App Router)", "تقرأ مباشرةً — بلا طبقة API")}
  ${arrow(610, 232, 610, 262)}

  ${box(60, 100, 300, 52, "مسارات API", "29 مساراً · 27 محروساً", "accent")}
  ${arrow(210, 152, 210, 180, "guard()")}
  ${box(60, 180, 300, 52, "services/guard.ts", "الصلاحية · حدّ الطلبات · 401/403/429", "warn")}
  ${arrow(210, 232, 210, 262)}

  ${box(230, 262, 420, 52, "الخدمات (services/) والمكتبات (lib/)", "المنطق الماليّ — دوالُّ خالصة حيثما أمكن")}
  ${arrow(440, 314, 440, 344)}
  ${box(230, 344, 420, 56, "Drizzle ORM → Neon Postgres", "42 جدولاً · مؤثِّرات تفرض الثوابت", "ok")}

  <text x="800" y="408" text-anchor="end" font-size="10.5" fill="${C.soft}">
    الصفحةُ تقرأ من الخدمات رأساً؛ وكلُّ كتابةٍ تمرّ بمسارٍ محروس.
  </text>
`);

/** ٢ · دورةُ حياة الفاتورة — من الملفّ إلى السداد. */
export const invoiceFlow = svg(860, 300, `
  ${box(700, 20, 140, 48, "الملفّ", "واتساب · ماسح")}
  ${arrow(700, 44, 660, 44)}
  ${box(520, 20, 140, 48, "الرفع", "/upload")}
  ${arrow(520, 44, 480, 44)}
  ${box(340, 20, 140, 48, "القراءة", "/api/analyze", "accent")}
  ${arrow(340, 44, 300, 44)}
  ${box(140, 20, 160, 48, "مراجعة الإنسان", "يُصحَّح قبل الحفظ", "warn")}

  ${arrow(220, 68, 220, 100)}
  ${box(140, 100, 160, 48, "الأرشفة", "/api/archive", "accent")}
  ${arrow(300, 124, 340, 124)}
  ${box(340, 100, 190, 48, "reviewConfirmed()", "الخادم يعيد اشتقاق الضريبة", "warn")}
  ${arrow(530, 124, 570, 124)}
  ${box(570, 100, 160, 48, "documents + invoices", "صفٌّ مقيَّد", "ok")}

  ${arrow(650, 148, 650, 180)}
  ${box(560, 180, 180, 48, "كشف البنك", "/api/bank-import")}
  ${arrow(560, 204, 520, 204)}
  ${box(340, 180, 180, 48, "المطابقة", "reconcile.service", "accent")}
  ${arrow(340, 204, 300, 204)}
  ${box(140, 180, 160, 48, "دفعة + تخصيص", "payments", "ok")}

  <text x="840" y="270" text-anchor="end" font-size="10.5" fill="${C.soft}">
    ولا يُكتب مالٌ إلّا بعد إقرار إنسان — المطابقةُ ترجيحٌ لا قرار.
  </text>
  <text x="840" y="288" text-anchor="end" font-size="10.5" fill="${C.soft}">
    والشهرُ المقفل يمنع الكتابة في الخدمات وفي القاعدة معاً.
  </text>
`);

/** ٣ · التنقّل: خمسُ مساحات وألسنتُها. */
export const navTree = svg(820, 330, `
  ${box(330, 16, 160, 44, "التطبيق", "5 مساحات", "accent")}

  ${arrow(410, 60, 730, 96)}
  ${arrow(410, 60, 570, 96)}
  ${arrow(410, 60, 410, 96)}
  ${arrow(410, 60, 250, 96)}
  ${arrow(410, 60, 90, 96)}

  ${box(660, 96, 150, 44, "الرئيسية", "/")}
  ${box(495, 96, 150, 44, "يحتاج قرارك", "/attention", "warn")}
  ${box(335, 96, 150, 44, "المورّدون", "/suppliers")}
  ${box(175, 96, 150, 44, "المال", "/money")}
  ${box(15, 96, 150, 44, "المستندات", "/documents")}

  ${arrow(410, 140, 410, 172)}
  ${box(300, 172, 220, 112, "", "")}
  <text x="500" y="192" text-anchor="end" font-size="11" fill="${C.ink}" font-weight="700">ألسنة المورّدين</text>
  <text x="500" y="210" text-anchor="end" font-size="10.5" fill="${C.soft}">الحسابات · /suppliers</text>
  <text x="500" y="226" text-anchor="end" font-size="10.5" fill="${C.soft}">الفواتير · /purchases/invoices</text>
  <text x="500" y="242" text-anchor="end" font-size="10.5" fill="${C.soft}">الكشوف · /statements</text>
  <text x="500" y="258" text-anchor="end" font-size="10.5" fill="${C.soft}">الأصناف والأسعار · /analysis</text>

  ${arrow(250, 140, 250, 172)}
  ${box(30, 172, 250, 112, "", "")}
  <text x="262" y="192" text-anchor="end" font-size="11" fill="${C.ink}" font-weight="700">ألسنة المال</text>
  <text x="262" y="210" text-anchor="end" font-size="10.5" fill="${C.soft}">أين ذهب · /money</text>
  <text x="262" y="226" text-anchor="end" font-size="10.5" fill="${C.soft}">حركة البنك · /bank</text>
  <text x="262" y="242" text-anchor="end" font-size="10.5" fill="${C.soft}">المصروفات · /money/expenses</text>
  <text x="262" y="258" text-anchor="end" font-size="10.5" fill="${C.soft}">دفعة الشهر · /payments · إقفال الشهر · /close</text>

  <text x="800" y="312" text-anchor="end" font-size="10.5" fill="${C.soft}">
    والإعدادات وسجلُّ التدقيق خارج التنقّل — في ذيل الشريط الجانبيّ.
  </text>
`);

/** ٤ · حارسُ الطلب — ما يقع قبل أن تُكتب كلمة. */
export const guardFlow = svg(820, 250, `
  ${box(660, 20, 150, 46, "طلب", "POST /api/…")}
  ${arrow(660, 43, 620, 43)}
  ${box(470, 20, 150, 46, "currentUser()", "جلسة أو تجربة")}
  ${arrow(470, 43, 430, 43)}
  ${box(280, 20, 150, 46, "can(role, cap)", "الصلاحية", "warn")}
  ${arrow(280, 43, 240, 43)}
  ${box(90, 20, 150, 46, "rate limit", "rate_limits")}

  ${arrow(165, 66, 165, 100)}
  ${box(90, 100, 150, 46, "المنطق", "services/")}
  ${arrow(240, 123, 280, 123)}
  ${box(280, 100, 180, 46, "معاملة قاعدة", "بمقبضها t لا db", "danger")}
  ${arrow(460, 123, 500, 123)}
  ${box(500, 100, 170, 46, "مؤثِّرات القاعدة", "تفرض الثوابت", "ok")}
  ${arrow(670, 123, 700, 123)}
  ${box(700, 100, 110, 46, "recordAudit", "أثرٌ لا يُحذف", "ok")}

  <text x="800" y="180" text-anchor="end" font-size="10.5" fill="${C.soft}">
    وأيُّ رميةٍ من الحارس تُترجَم في respondTo(e) إلى 401 أو 403 أو 429 — لا 500 صامت.
  </text>
  <text x="800" y="200" text-anchor="end" font-size="10.5" fill="${C.soft}">
    والكتابةُ داخل المعاملة بمقبضها «t»: استعمالُ «db» يحجز اتّصالاً ثانياً فيتعلّق الطلب.
  </text>
  <text x="800" y="220" text-anchor="end" font-size="10.5" fill="${C.soft}">
    ويحرسه code-guards.test.ts نصّاً — لأنّ المترجم لا يراه.
  </text>
`);

/** ٥ · مصدرُ الحقيقة لكلّ رقم. */
export const truthMap = svg(820, 300, `
  ${box(600, 20, 200, 50, "عليك للمورّدين", "supplier-balance.service", "ok")}
  ${arrow(700, 70, 700, 104)}
  <text x="795" y="96" text-anchor="end" font-size="10.5" fill="${C.soft}">يُقرأ في:</text>
  ${box(620, 104, 180, 38, "الرئيسية", "")}
  ${box(620, 150, 180, 38, "حسابات المورّدين", "")}
  ${box(620, 196, 180, 38, "ملفّ المورّد", "")}

  ${box(330, 20, 220, 50, "دفعات لم تُنسب", "loadUnbackedPayments", "ok")}
  ${arrow(440, 70, 440, 104)}
  ${box(350, 104, 180, 38, "حسابات المورّدين", "")}
  ${box(350, 150, 180, 38, "حركة البنك", "")}
  ${box(350, 196, 180, 38, "يحتاج قرارك", "")}

  ${box(40, 20, 230, 50, "العمل الباقي", "attentionItems() — lib/work", "ok")}
  ${arrow(155, 70, 155, 104)}
  ${box(60, 104, 180, 38, "شارة الشريط", "")}
  ${box(60, 150, 180, 38, "الرئيسية", "")}
  ${box(60, 196, 180, 38, "يحتاج قرارك", "")}

  <text x="800" y="272" text-anchor="end" font-size="10.5" fill="${C.soft}">
    كان لكلّ شاشةٍ حسابُها، فاختلفت الأعدادُ تحت العنوان الواحد. فصار لكلّ مفهومٍ مصدرٌ واحد يقرؤه الجميع.
  </text>
`);
