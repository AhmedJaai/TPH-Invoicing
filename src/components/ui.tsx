import Link from "next/link";
import { Suspense, ViewTransition, useId } from "react";
import { ArrowDown, ArrowUp, Check, Inbox, Minus, TriangleAlert, type LucideIcon } from "lucide-react";
import { Money, Prose } from "./money";
import { LiveMoney } from "./live-money";
import { ScrollX } from "./scroll-x";
import { LinkPending, RowLink, SortHeader, SortSelect, TableFilter } from "./ui-client";
import { parseSort, sortRows, type SortValue } from "@/lib/table-sort";

/**
 * عناصر الواجهة المشتركة — نظامُ التصميم الثاني.
 *
 * كلُّ ما يتكرّر في الشاشات يُرسَم هنا: البطاقة والقسم والزرّ والشارة
 * والرقم والجدول والحالات الفارغة والخطّ الزمنيّ والخطوات. فتغييرُ
 * عنصرٍ هنا يغيّر التطبيق كلَّه، ولا تكتب صفحةٌ جدولها بنفسها.
 *
 * كلّها بلا حالة فتصلح للخادم. وما يحتاج تفاعلاً في `ui-client.tsx`.
 */

/* ─────────────────────────── النبرات ─────────────────────────── */

export type Tone = "warn" | "danger" | "ok" | "muted" | "info" | "accent";

export const TONE_TEXT: Record<Tone, string> = {
  warn: "text-warn",
  danger: "text-danger",
  ok: "text-ok",
  muted: "text-muted",
  info: "text-info",
  accent: "text-accent",
};

const TONE_SURFACE: Record<Tone, string> = {
  warn: "border-warn/25 bg-warn-bg",
  danger: "border-danger/25 bg-danger-bg",
  ok: "border-ok/25 bg-ok-bg",
  muted: "border-line bg-sunken",
  info: "border-info/25 bg-info-bg",
  accent: "border-accent-line bg-accent-soft",
};

const TONE_DOT: Record<Tone, string> = {
  warn: "bg-warn",
  danger: "bg-danger",
  ok: "bg-ok",
  muted: "bg-muted",
  info: "bg-info",
  accent: "bg-accent",
};

/* ─────────────────────────── الطبقات ─────────────────────────── */

export function Card({
  children,
  tone,
  href,
  className = "",
  padded = true,
}: {
  children: React.ReactNode;
  tone?: Tone;
  href?: string;
  className?: string;
  padded?: boolean;
}) {
  const base = `rounded-xl border shadow-raised ${padded ? "p-4 sm:p-5" : ""} ${
    tone ? TONE_SURFACE[tone] : "border-line bg-raised"
  } ${className}`;

  if (!href) return <div className={base}>{children}</div>;
  return (
    <Link
      href={href}
      className={`${base} block transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:border-accent-line hover:shadow-lifted`}
    >
      {children}
    </Link>
  );
}

/**
 * عنوان قسم مع فعله — الفعل بجانب العنوان لا في ذيل القسم.
 */
export function Section({
  id,
  title,
  hint,
  action,
  icon: Icon,
  count,
  children,
  className = "",
}: {
  /** مرساةٌ يهبط إليها رابطٌ من تنبيه — فالعدد يفتح سجلّه لا رأس الصفحة. */
  id?: string;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  icon?: LucideIcon;
  /** عددُ ما في القسم — يُكتب بجانب العنوان. */
  count?: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`mt-10 scroll-mt-24 first:mt-0 ${className}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="flex items-center gap-2 text-[15px] font-bold leading-tight sm:text-base">
          {Icon && <Icon className="h-[18px] w-[18px] text-muted" strokeWidth={1.75} aria-hidden />}
          {title}
          {count !== undefined && (
            <span className="nums nums-count rounded-full bg-sunken px-2 py-0.5 text-[11px] font-bold text-ink-soft">{count}</span>
          )}
        </h2>
        {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
      </div>
      {hint && (
        <p className="-mt-1 mb-3 max-w-3xl text-xs leading-relaxed text-muted">
          <Prose text={hint} />
        </p>
      )}
      {children}
    </section>
  );
}

/* ─────────────────────────── الأفعال ─────────────────────────── */

export { buttonClass, type ButtonVariant } from "./ui-tokens";
import { buttonClass, type ButtonVariant } from "./ui-tokens";

export function LinkButton({
  href,
  variant = "secondary",
  size = "md",
  icon: Icon,
  children,
  className = "",
  prefetch,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
  prefetch?: boolean;
}) {
  return (
    <Link href={href} prefetch={prefetch} className={`${buttonClass(variant, size)} ${className}`}>
      {Icon && <Icon className="h-4 w-4" strokeWidth={2} aria-hidden />}
      {children}
      <LinkPending />
    </Link>
  );
}

/** شارةُ حال: نقطةٌ وكلمة — اللونُ لا يأتي وحده. */
export function Badge({
  tone,
  dot = false,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  children: React.ReactNode;
}) {
  const cls = tone
    ? `${TONE_SURFACE[tone]} ${TONE_TEXT[tone]}`
    : "border-line bg-sunken text-ink-soft";
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-bold leading-5 ${cls}`}>
      {dot && <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${tone ? TONE_DOT[tone] : "bg-muted"}`} />}
      {children}
    </span>
  );
}

/**
 * مفتاحُ اختصار — شكلٌ واحد في التطبيق كلّه، و`dir="ltr"` كي لا ينقلب «⌘K».
 * `frame` للشريط الجانبيّ الداكن، و`inherit` لما يقع فوق زرٍّ ملوَّن فيأخذ لونه.
 */
export function Kbd({
  children,
  tone = "surface",
  className = "",
}: {
  children: React.ReactNode;
  tone?: "surface" | "frame" | "inherit";
  className?: string;
}) {
  const skin =
    tone === "frame" ? "border-frame-line text-frame-muted"
    : tone === "inherit" ? "border-current/25"
    : "border-line border-b-2 bg-raised text-ink-soft";
  return (
    <kbd dir="ltr" className={`inline-flex min-w-5 shrink-0 items-center justify-center rounded-md border px-1 font-sans text-[11px] font-medium leading-4 ${skin} ${className}`}>
      {children}
    </kbd>
  );
}

/* ─────────────────────────── الأرقام ─────────────────────────── */

/**
 * رقمٌ في بطاقة: الرقمُ أوّلاً وأكبر، والوصفُ تحته. وحين يكون له وجهة
 * يصير كلُّه قابلاً للنقر.
 */
export function Stat({
  label,
  value,
  minor,
  sub,
  tone,
  href,
  icon: Icon,
}: {
  label: string;
  value?: React.ReactNode;
  minor?: number;
  sub?: React.ReactNode;
  tone?: Tone;
  href?: string;
  icon?: LucideIcon;
}) {
  return (
    <Card href={href} padded={false} className="h-full">
      <div className="flex h-full flex-col px-4 py-4 sm:px-5">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted">
          {Icon && <Icon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />}
          {label}
        </p>
        {/* `.nums` على الرقم وحده — «غير معروف» تُكتب بخطّ الواجهة */}
        {/* الرقمُ يصغر بمقاس بطاقته (`cqi`): مبلغٌ سداسيّ في عمودٍ من اثنين على الجوّال لا يفيض */}
        <div className="@container mt-2.5">
          <p className={`${isNumeric(value) || minor !== undefined ? "nums " : ""}text-[clamp(1.15rem,13cqi,1.6rem)] font-semibold leading-none tracking-tight sm:text-[1.75rem] ${tone ? TONE_TEXT[tone] : ""}`}>
            {minor !== undefined ? <LiveMoney minor={minor} /> : value}
          </p>
        </div>
        {sub && (
          <p className="mt-auto pt-2.5 text-xs leading-relaxed text-muted">
            {typeof sub === "string" ? <Prose text={sub} /> : sub}
          </p>
        )}
      </div>
    </Card>
  );
}

/**
 * رقمُ الرأس — أيقونةٌ وتسمية، والرقمُ كبيراً، وجملةٌ تقول معناه، ويفتح موضعه.
 *
 * كانت ثلاثُ صفحاتٍ (اليوم · النقد القادم · المورّدون) تكتب هذه البطاقة
 * بنفسها بمقاساتٍ متقاربة لا متطابقة. و`children` لما تحت الرقم ممّا له
 * روابطُه (شريطُ أعمار) — فلا يُلفّ رابطٌ داخل رابط.
 */
export function KeyFigure({
  icon: Icon,
  label,
  value,
  sub,
  href,
  tone,
  delta,
  children,
  className = "",
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  href?: string;
  tone?: "warn" | "danger" | "ok";
  /** نسبةُ التغيّر بجانب التسمية — `null` «بلا مقارنة». */
  delta?: number | null;
  children?: React.ReactNode;
  className?: string;
}) {
  const chip =
    tone === "danger" ? "bg-danger-bg text-danger"
    : tone === "warn" ? "bg-warn-bg text-warn"
    : tone === "ok" ? "bg-ok-bg text-ok"
    : "bg-sunken text-ink-soft group-hover:bg-accent-soft group-hover:text-accent";
  const ink = tone ? TONE_TEXT[tone] : "";
  const body = (
    <>
      <span className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-bold text-muted">
          <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-colors ${chip}`}>
            <Icon className="h-4 w-4" strokeWidth={2} aria-hidden />
          </span>
          {label}
        </span>
        {delta !== undefined && <Delta pct={delta} />}
      </span>
      {/* الرقمُ الكبير نصفُ غامق — الثقةُ في الحجم لا في الوزن (Stripe) */}
      <span className="@container mt-4 block">
        <span className={`block text-[clamp(1.15rem,13cqi,1.6rem)] font-semibold leading-none tracking-tight sm:text-[2rem] ${ink}`}>{value}</span>
      </span>
      {sub && <span className="mt-3 block text-xs leading-relaxed text-muted">{sub}</span>}
    </>
  );
  const frame = `group flex min-h-[9.5rem] flex-col rounded-2xl border border-line bg-raised p-4 shadow-raised transition-[border-color,box-shadow,transform] duration-150 sm:p-5 ${className}`;
  if (href && !children) {
    return (
      <Link href={href} className={`${frame} hover:-translate-y-px hover:border-accent-line hover:shadow-lifted`}>
        {body}
      </Link>
    );
  }
  return (
    <div className={`${frame} ${href ? "has-[a:hover]:border-accent-line has-[a:hover]:shadow-lifted" : ""}`}>
      {href ? <Link href={href} className="-m-1 block rounded-xl p-1">{body}</Link> : body}
      {children && <div className="mt-auto pt-4">{children}</div>}
    </div>
  );
}

/** قيمةٌ نصّها أرقامٌ صرفة — وحدها تستحقّ خطّ الأرقام. */
export function isNumeric(value: React.ReactNode): boolean {
  return typeof value === "number" || (typeof value === "string" && /^[\d\s.,٫٬%٪+\-/]+$/.test(value));
}

/**
 * صفُّ الأرقام — يتّسع لما فيه: أربعٌ تقتسم السطر، وواحدةٌ لا تقبع في ربعه.
 * بمقاس الوعاء لا الشاشة (`@container` في `PageShell` ولوح الفحص).
 */
export function StatGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 @3xl:grid-cols-[repeat(auto-fit,minmax(13rem,1fr))]">{children}</div>;
}

/**
 * اتّجاهُ التغيّر: سهمٌ ونسبة، واللونُ لمن يُعرف أهو في صالحه.
 * ارتفاعُ المشتريات لا لون له — قد يكون نموّاً وقد يكون تسرّباً.
 */
export function Delta({ pct, favourable }: { pct: number | null; favourable?: boolean | null }) {
  if (pct === null) return <span className="text-[11px] text-muted">بلا مقارنة</span>;
  const up = pct > 0;
  const tone = favourable === true ? "text-ok bg-ok-bg" : favourable === false ? "text-warn bg-warn-bg" : "text-ink-soft bg-sunken";
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[11px] font-bold ${tone}`}>
      {/* أيقوناتُ lucide لا حروفٌ بخطّ النظام: «▲▼» تختلف وزناً بين الأجهزة وقد تصير رمزاً ملوَّناً */}
      {up ? <ArrowUp className="h-3 w-3" strokeWidth={2.5} aria-hidden /> : pct < 0 ? <ArrowDown className="h-3 w-3" strokeWidth={2.5} aria-hidden /> : <Minus className="h-3 w-3" strokeWidth={2.5} aria-hidden />}
      <span className="sr-only">{up ? "ارتفاع" : pct < 0 ? "انخفاض" : "ثبات"}</span>
      {/* «٪» حرفٌ عربيّ يقلب موضعَ الرقم بجوار نصٍّ لاتينيّ — يُعزَل الاثنان معاً */}
      <bdi dir="rtl"><span className="nums nums-count">{Math.abs(Math.round(pct))}</span>٪</bdi>
    </span>
  );
}

/** شريطُ تقدّمٍ حقيقيّ — لا يُرسَم إلّا لنسبةٍ معروفةٍ مقامُها. */
export function Meter({
  value,
  max,
  tone = "accent",
  label,
}: {
  value: number;
  max: number;
  tone?: Tone;
  label: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className="h-1.5 w-full overflow-hidden rounded-full bg-sunken"
    >
      {/* يتحرّك بالتحويل لا بالعرض — لا يُعاد تخطيطُ الصفحة مع كلّ إطار */}
      <div
        className={`h-full w-full rounded-full ${TONE_DOT[tone]} origin-right transition-transform duration-(--dur-4) ease-(--ease-standard) ltr:origin-left`}
        style={{ transform: `scaleX(${pct / 100})` }}
      />
    </div>
  );
}

/**
 * منحنى صغير — من قيمٍ حقيقيّة وحدها. قيمةٌ مجهولة (`null`) تقطع الخطّ
 * ولا تُرسَم صفراً.
 */
export function Sparkline({
  values,
  className = "h-8 w-24",
  tone = "accent",
  label,
}: {
  values: readonly (number | null)[];
  className?: string;
  tone?: Tone;
  label: string;
}) {
  const known = values.filter((v): v is number => v !== null);
  if (known.length < 2) return null;
  const min = Math.min(...known);
  const max = Math.max(...known);
  const span = max - min || 1;
  const w = 100;
  const h = 32;
  const step = values.length > 1 ? w / (values.length - 1) : w;
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v === null) { pen = false; return; }
    const x = i * step;
    const y = h - 3 - ((v - min) / span) * (h - 6);
    d += `${pen ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)} `;
    pen = true;
  });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={`${className} ${TONE_TEXT[tone]}`} role="img" aria-label={label}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * قائمةُ أشرطة: كلُّ صفٍّ اسمٌ ومبلغٌ وشريطٌ نسبتُه من الأكبر.
 */
export function BarList({
  items,
  tone = "accent",
}: {
  items: readonly { key: string; label: React.ReactNode; minor: number; href?: string; sub?: string }[];
  tone?: Tone;
}) {
  const max = Math.max(1, ...items.map((i) => i.minor));
  return (
    <ul className="space-y-1">
      {items.map((i) => {
        const pct = Math.max(2, (i.minor / max) * 100);
        const inner = (
          <>
            <span className="relative z-10 min-w-0 flex-1 truncate text-[13px]">
              {i.label}
              {i.sub && <span className="ms-2 text-[11px] text-muted">{i.sub}</span>}
            </span>
            <span className="relative z-10 shrink-0 text-[13px] font-bold"><Money minor={i.minor} /></span>
            <span aria-hidden className={`absolute inset-y-1 start-0 rounded-md opacity-[0.14] ${TONE_DOT[tone]}`} style={{ width: `${pct}%` }} />
          </>
        );
        const cls = "relative flex min-h-10 items-center gap-3 overflow-hidden rounded-lg px-2.5";
        return (
          <li key={i.key}>
            {i.href ? (
              <Link href={i.href} className={`${cls} transition-colors hover:bg-hover`}>{inner}</Link>
            ) : (
              <div className={cls}>{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ─────────────────────────── الهويّة ─────────────────────────── */

const MONO_HUES = [
  "bg-accent-soft text-accent",
  "bg-info-bg text-info",
  "bg-plum-bg text-plum",
  "bg-sand-bg text-sand",
  "bg-sunken text-ink-soft",
];

/** حرفُ الاسم في دائرة — يميّز المورّد بالعين في قائمةٍ طويلة. */
export function Monogram({ name, className = "h-8 w-8 text-[13px]" }: { name: string; className?: string }) {
  const clean = name.replace(/^(ال|شركة|مؤسسة)\s*/u, "").trim() || name;
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center rounded-full font-bold ${MONO_HUES[h % MONO_HUES.length]} ${className}`}>
      {clean.charAt(0)}
    </span>
  );
}

/* ─────────────────────────── الحالات ─────────────────────────── */

/**
 * علامةُ «انتهى» تُرسَم رسماً — دائرةٌ ثمّ صحّ، في ٥٠٠ مللي ثانية.
 *
 * لحظةُ فراغ الطابور أو إقفال الشهر إنجاز، وتستحقّ أن تُرى — بلا ألعابٍ
 * نارية ولا ارتداد. وتُرسم مرّةً عند الظهور، ولمن طلب تقليل الحركة تظهر كاملة.
 */
export function DoneMark({ className = "h-14 w-14" }: { className?: string }) {
  return (
    <svg viewBox="0 0 52 52" className={`done-mark ${className}`} role="img" aria-label="تمّ">
      <circle cx="26" cy="26" r="24" fill="none" stroke="currentColor" strokeWidth="2.5" className="done-mark-ring" />
      <path d="M15 27 l7.5 7.5 L37 19" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="done-mark-tick" />
    </svg>
  );
}

/**
 * الفراغ يقول ما الذي يملؤه — لماذا هو فارغ وما الخطوة التي تملؤه.
 */
export function EmptyState({
  title,
  hint,
  action,
  icon: Icon = Inbox,
  compact = false,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  icon?: LucideIcon;
  compact?: boolean;
}) {
  return (
    <div className={`rounded-xl border border-dashed border-line bg-raised/60 px-5 text-center ${compact ? "py-7" : "py-12"}`}>
      <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-accent-soft text-accent">
        <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
      </span>
      <p className="mt-3 text-sm font-bold">{title}</p>
      {hint && <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-muted"><Prose text={hint} /></p>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

/**
 * تنبيهٌ داخل الصفحة: نبرةٌ ورمزٌ وجملةٌ وفعلٌ بجانبه — لا فقرةٌ ملوّنة بلا مخرج.
 */
export function Callout({
  tone = "info",
  icon: Icon,
  title,
  children,
  action,
  className = "",
}: {
  tone?: Tone;
  icon?: LucideIcon;
  title?: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div role={tone === "danger" ? "alert" : undefined} className={`flex flex-wrap items-start gap-3 rounded-xl border px-4 py-3 ${TONE_SURFACE[tone]} ${className}`}>
      {Icon && <Icon className={`mt-0.5 h-[18px] w-[18px] shrink-0 ${TONE_TEXT[tone]}`} strokeWidth={2} aria-hidden />}
      {/* `basis-56`: على الجوّال ينزل الفعلُ تحت النصّ بدل أن يعصره عموداً من كلمتين */}
      <div className="min-w-0 flex-1 basis-56 text-xs leading-relaxed text-ink-soft">
        {title && <p className={`text-[13px] font-bold ${TONE_TEXT[tone]}`}>{title}</p>}
        {children && <div className={title ? "mt-0.5" : ""}>{children}</div>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap gap-2">{action}</div>}
    </div>
  );
}

/**
 * صفحةٌ خارج الصلاحية — ولمن يُطلَب الإذن.
 */
export function NoAccess({ what }: { what?: string }) {
  return (
    /* `data-no-access`: الزاحفُ بدورٍ غير المالك يعدّ كلَّ صفحةٍ كهذه وصلها رابطٌ ظاهرٌ له طريقاً مسدوداً */
    <div data-no-access="">
      <EmptyState
        title={what ? `${what} خارج صلاحيتك.` : "هذه الصفحة خارج صلاحيتك."}
        hint="اطلب من مالك الحساب توسيع صلاحيتك، ثمّ حدّث الصفحة."
      />
    </div>
  );
}

/* ─────────────────────────── القوائم ─────────────────────────── */

/** أزواجُ اسمٍ وقيمة — لملفّ مورّدٍ أو فاتورة. */
export function KeyValue({
  items,
  columns = 2,
}: {
  items: readonly { label: string; value: React.ReactNode; hint?: string }[];
  columns?: 2 | 3 | 4;
}) {
  const cols = columns === 4 ? "sm:grid-cols-4" : columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2";
  return (
    <dl className={`grid grid-cols-2 gap-x-6 gap-y-4 ${cols}`}>
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-[11px] font-medium text-muted">{i.label}</dt>
          {/* آيبانٌ أو رقمٌ ضريبيّ أو اسمُ ملفّ — سلسلةٌ بلا مسافات تُكسَر ولا تفيض من عمودها */}
          <dd className="mt-1 break-words text-sm font-medium leading-snug [overflow-wrap:anywhere]">{i.value}</dd>
          {i.hint && <dd className="mt-0.5 text-[11px] text-muted">{i.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}

export type TimelineItem = {
  id: string;
  title: React.ReactNode;
  meta?: React.ReactNode;
  body?: React.ReactNode;
  tone?: Tone;
  icon?: LucideIcon;
  href?: string;
};

/** خطٌّ زمنيّ: ما حدث، ومتى، ومَن — بترتيبه. */
export function Timeline({ items }: { items: readonly TimelineItem[] }) {
  return (
    <ol className="relative space-y-0">
      {items.map((i, idx) => {
        const Icon = i.icon;
        return (
          <li key={i.id} className="relative flex gap-3 pb-5 last:pb-0">
            {idx < items.length - 1 && <span aria-hidden className="absolute start-[13px] top-7 bottom-0 w-px bg-line" />}
            <span className={`relative z-10 mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line bg-raised ${i.tone ? TONE_TEXT[i.tone] : "text-muted"}`}>
              {Icon ? <Icon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden /> : <span className={`h-2 w-2 rounded-full ${i.tone ? TONE_DOT[i.tone] : "bg-muted"}`} />}
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="text-[13px] font-bold leading-snug">
                  {i.href ? <Link href={i.href} className="hover:text-accent hover:underline hover:underline-offset-4">{i.title}</Link> : i.title}
                </p>
                {i.meta && <p className="shrink-0 text-[11px] text-muted">{i.meta}</p>}
              </div>
              {i.body && <div className="mt-1 text-xs leading-relaxed text-ink-soft">{i.body}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export type StepState = "done" | "current" | "todo" | "blocked";

/** خطواتٌ بترتيبها: ما تمّ، وما الآن، وما يمنع. */
export function Stepper({
  steps,
}: {
  steps: readonly { id: string; title: string; detail?: React.ReactNode; state: StepState; action?: React.ReactNode }[];
}) {
  const DOT: Record<StepState, string> = {
    done: "border-ok bg-ok text-raised",
    current: "border-accent bg-accent-soft text-accent",
    todo: "border-line bg-raised text-muted",
    blocked: "border-danger/50 bg-danger-bg text-danger",
  };
  return (
    <ol className="space-y-2">
      {steps.map((s, i) => (
        <li
          key={s.id}
          className={`flex flex-wrap items-start gap-3 rounded-xl border px-4 py-3.5 ${
            s.state === "current" ? "border-accent-line bg-raised shadow-lifted" : "border-line bg-raised"
          }`}
        >
          <span aria-hidden className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 text-xs font-bold ${DOT[s.state]}`}>
            {s.state === "done"
              ? <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
              : s.state === "blocked"
                ? <TriangleAlert className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
                : <span className="nums nums-count">{i + 1}</span>}
          </span>
          <div className="min-w-0 flex-1 basis-48">
            <p className={`text-sm font-bold ${s.state === "done" ? "text-muted" : ""}`}>
              {s.title}
              <span className="sr-only">
                {s.state === "done" ? " — تمّت" : s.state === "blocked" ? " — متوقّفة" : s.state === "current" ? " — الخطوة الحاليّة" : ""}
              </span>
            </p>
            {s.detail && <div className="mt-0.5 text-xs leading-relaxed text-muted">{s.detail}</div>}
          </div>
          {s.action && <div className="shrink-0">{s.action}</div>}
        </li>
      ))}
    </ol>
  );
}

/** ألسنةٌ داخل الصفحة بروابط — التصفيةُ في العنوان فتُحفَظ وتُشارَك. */
export function LinkTabs({
  items,
  label,
}: {
  items: readonly { href: string; label: string; count?: number | null; active: boolean }[];
  label: string;
}) {
  return (
    <nav aria-label={label} className="scroll-x -mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          scroll={false}
          aria-current={t.active ? "page" : undefined}
          className={`relative inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-bold transition-colors sm:min-h-8 ${
            t.active ? "text-inverse-ink" : "text-ink-soft hover:bg-hover hover:text-ink"
          }`}
        >
          {/* الخلفيّةُ المختارة تنزلق بين الألسنة — بالاسم نفسه في الحالين فتُقرأ شيئاً واحداً */}
          {t.active && (
            <ViewTransition name={`tabs-${label.replace(/\s+/g, "-")}`} share="tab-slide" default="none">
              <span aria-hidden className="absolute inset-0 rounded-lg bg-inverse-surface" />
            </ViewTransition>
          )}
          <span className="relative">{t.label}</span>
          {t.count !== undefined && t.count !== null && (
            <span className={`nums nums-count relative rounded-full px-1.5 text-[10px] ${t.active ? "bg-inverse-ink/15" : "bg-sunken"}`}>{t.count}</span>
          )}
          <LinkPending />
        </Link>
      ))}
    </nav>
  );
}

/* ─────────────────────────── القوائمُ التي تُحسم ─────────────────────────── */

/**
 * بندٌ في قائمةٍ تُحسم بنوداً — يخرج بحركةٍ حين يُحسم، وما تحته ينزلق إلى
 * مكانه ولا يقفز. (`<ViewTransition>`: الحذفُ بعد `router.refresh()` انتقالٌ
 * فتتحرّك فيه البنودُ المسمّاة.) و`scope` يميّز القائمة: المعرّفُ نفسُه قد
 * يقع في قائمتين في صفحةٍ واحدة، والاسمُ المكرَّر يُسقط الحركة كلَّها.
 */
export function FlowItem({ scope, id, children }: { scope: string; id: string; children: React.ReactNode }) {
  return (
    <ViewTransition
      name={`${scope}-${id.replace(/[^A-Za-z0-9_-]/g, "_")}`}
      enter="flow-in"
      exit="flow-out"
      update="flow-move"
      share="flow-move"
      default="none"
    >
      {children}
    </ViewTransition>
  );
}

/* ─────────────────────────── الجداول ─────────────────────────── */

export interface Column<T> {
  key: string;
  header: string;
  /** يُعرَض في الجدول وفي البطاقة معاً. */
  cell: (row: T) => React.ReactNode;
  align?: "start" | "end";
  /**
   * عمود مال أو عدد — تصطفّ فواصله على خطٍّ واحد. يسبق `align`: المال
   * يُصفّ على آخر خانةٍ منه، أي اليمين الفيزيائيّ.
   */
  numeric?: boolean;
  /** عمودٌ ثانويّ يُخفى على الشاشات الضيّقة داخل الجدول. */
  secondary?: boolean;
  /** عنوان البطاقة على الجوّال — يُعرَض بارزاً بلا تسمية. */
  primary?: boolean;
  /**
   * خليّةٌ لا تُقصّ على الجوّال — ما كانت خليّتُه فعلاً لا نصّاً
   * (لوحُ إقرارٍ يُفتح داخلها) لا يُبتلَع بـ`overflow: hidden`.
   */
  wrap?: boolean;
  /**
   * فعلٌ يتكرّر في كلّ صفّ — يظهر للصفّ الذي تحت الفأرة أو فيه التركيز وحده
   * على الحاسوب (Linear)، فلا يصير الجدولُ عموداً من أزرارٍ متطابقة. وعلى
   * الجوّال وما لا فأرةَ له ظاهرٌ دائماً — لا شيء يُخبَّأ عن اللمس.
   */
  reveal?: boolean;
  /**
   * قيمةُ الترتيب — بها يصير رأسُ العمود زرّاً يرتّب (والجدولُ يأخذ `sort`).
   * مالٌ بالهللات أو نصّ؛ و`null` لما لا يُعرف: يقع آخراً ولا يُعدّ صفراً.
   */
  sortBy?: (row: T) => SortValue;
  /** اتّجاهُ الضغطة الأولى — الأصل: المالُ من الأكبر والنصُّ من أوّله. */
  sortFirst?: "asc" | "desc";
}

/** فوق كم صفّاً يثبت رأسُ الجدول ويُبحَث فيه. */
const LONG_TABLE = 15;

/**
 * جدولٌ يصير بطاقاتٍ على الجوّال.
 *
 * - رأسٌ ثابت وبحثٌ داخل الجدول حين تطول الصفوف (`searchOf`).
 * - عمودُ المال يصطفّ على آخر خانة.
 * - الصفُّ كلُّه يفتح سجلَّه، والرابطُ طبقةٌ تحت المحتوى لا غلاف.
 * - `j`/`k` تتنقّل بين الصفوف و`Enter` تفتح (`data-nav-item`)، وTab يبلغ رابطَ
 *   الصفّ باسم عموده الأساسيّ.
 * - الترتيبُ بالعمود: `sortBy` على العمود و`sort` من عنوان الصفحة
 *   (`searchParams.sort`) — رأسُ العمود يكتب `?sort=key.desc` والخادمُ يرتّب.
 */
export function DataTable<T>({
  columns,
  rows: given,
  keyOf,
  empty,
  hrefOf,
  searchOf,
  searchLabel = "ابحث في هذا الجدول",
  sort,
  sortParam = "sort",
}: {
  columns: readonly Column<T>[];
  rows: readonly T[];
  keyOf: (row: T) => string;
  empty?: React.ReactNode;
  hrefOf?: (row: T) => string | undefined;
  /** نصُّ الصفّ للبحث داخل الجدول — يظهر الحقل حين تطول الصفوف. */
  searchOf?: (row: T) => string;
  searchLabel?: string;
  /**
   * قيمةُ `?sort=` كما وصلت (أو `null` حين لا ترتيب) — تمريرُها يفعّل الترتيبَ
   * بالأعمدة التي تحمل `sortBy`. وما لا يُفهم منها يُهمَل.
   */
  sort?: string | null;
  /** اسمُ الوسيط في العنوان — لصفحةٍ فيها جدولان يُرتَّبان. */
  sortParam?: string;
}) {
  const uid = useId();
  const sortable = sort !== undefined ? columns.filter((c) => c.sortBy) : [];
  const active = sortable.length > 0 ? parseSort(sort, sortable.map((c) => c.key)) : null;
  const by = active ? sortable.find((c) => c.key === active.key)?.sortBy : undefined;
  const rows = active && by ? sortRows(given, by, active.dir) : given;

  if (rows.length === 0) {
    return (
      <>
        {empty ?? (
          <EmptyState
            title="لا شيء في هذا الجدول بعد."
            hint="يمتلئ حين يصل ما يخصّه — فاتورةً تُرفع، أو كشفاً يُستورَد."
          />
        )}
      </>
    );
  }

  const primary = columns.find((c) => c.primary) ?? columns[0];
  const rest = columns.filter((c) => c !== primary);
  /* بطاقةُ الجوّال: أوّلُ عمودِ مالٍ (لا فعلٍ ولا لوح) يُرفع إلى سطر العنوان */
  const amount = rest.find((c) => c.numeric && !c.reveal && !c.wrap && c.header);
  const main = rest.filter((c) => c !== amount && !c.secondary);
  const extra = rest.filter((c) => c !== amount && c.secondary);
  const long = rows.length > LONG_TABLE;
  const searchable = !!searchOf && rows.length > 8;

  return (
    /* `relative` هنا وعلى الإطار: نصُّ `sr-only` داخل خليّةٍ مطلقُ الموضع، وبلا
       أبٍ موضوعٍ يفلت إلى الصفحة فيطيلها بطول الجدول كلّه (٨٤٥٢ بكسلاً في /bank). */
    /* `@container`: جدولٌ أو بطاقاتٌ بمقاس الوعاء لا الشاشة — يصحّ في الصفحة وفي لوح الفحص */
    <div data-filter-root="" className="@container relative">
      {searchable && <TableFilter label={searchLabel} total={rows.length} />}
      {/* الجوّال بلا رؤوس أعمدة — الترتيبُ نفسُه بقائمةٍ فوق البطاقات */}
      {sortable.length > 0 && (
        <div className="mb-3 @xl:hidden">
          <Suspense fallback={null}>
            <SortSelect
              param={sortParam}
              options={sortable.map((c) => ({ key: c.key, label: c.header, first: c.sortFirst ?? (c.numeric ? "desc" : "asc") }))}
            />
          </Suspense>
        </div>
      )}

      {/* الحاسوب: جدول */}
      <ScrollX
        className={`relative hidden rounded-xl border border-line bg-raised shadow-raised @xl:block ${long ? "max-h-[min(72vh,60rem)] overflow-y-auto" : ""}`}
      >
        <table className="w-full border-separate border-spacing-0 text-[13px]">
          <thead className={long ? "sticky top-0 z-10" : ""}>
            <tr>
              {columns.map((c) => {
                const canSort = sort !== undefined && !!c.sortBy && !!c.header;
                const dir = active?.key === c.key ? active.dir : null;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={canSort ? (dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none") : undefined}
                    className={`whitespace-nowrap border-b border-line bg-sunken/80 px-3.5 py-2.5 text-[11px] font-bold text-muted backdrop-blur first:rounded-ss-xl last:rounded-se-xl ${
                      c.numeric ? "text-start" : c.align === "end" ? "text-end" : "text-start"
                    } ${c.secondary ? "hidden @4xl:table-cell" : ""}`}
                  >
                    {canSort ? (
                      /* الرأسُ يقرأ العنوانَ في المتصفّح — وريثما يُركَّب يُرى نصُّه كما كان */
                      <Suspense fallback={c.header}>
                        <SortHeader param={sortParam} sortKey={c.key} first={c.sortFirst ?? (c.numeric ? "desc" : "asc")}>{c.header}</SortHeader>
                      </Suspense>
                    ) : (
                      c.header || <span className="sr-only">الفعل</span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => {
              const href = hrefOf?.(row);
              return (
                <tr
                  key={keyOf(row)}
                  data-filter={searchOf ? searchOf(row) : undefined}
                  data-nav-item={href ? "" : undefined}
                  data-href={href}
                  className={`group transition-colors duration-(--dur-1) hover:bg-hover ${href ? "card-rows relative cursor-pointer" : ""}`}
                >
                  {columns.map((c, i) => (
                    <td
                      key={c.key}
                      id={href && c === primary ? `${uid}-r${r}` : undefined}
                      className={`border-b border-line-soft px-3.5 py-3 align-middle group-last:border-b-0 ${
                        c.numeric ? "nums-col" : c.align === "end" ? "text-end" : "text-start"
                      } ${c.secondary ? "hidden @4xl:table-cell" : ""} ${c.reveal ? "row-reveal" : ""}`}
                    >
                      {i === 0 && href && (
                        /* يُبلَغ بـTab ويُسمّى بعموده الأساسيّ — كان `tabIndex={-1}` فلا يفتح الصفَّ إلّا الفأرةُ وJ/K */
                        <RowLink href={href} labelledBy={`${uid}-r${r}`} className="absolute inset-0 rounded-lg" />
                      )}
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollX>

      {/* الجوّال: بطاقات، ورابطُ البطاقة طبقةٌ لا غلاف — لا `<a>` داخل `<a>` */}
      <ul className="space-y-2 @xl:hidden">
        {rows.map((row) => {
          const href = hrefOf?.(row);
          return (
            <li key={keyOf(row)} data-filter={searchOf ? searchOf(row) : undefined}>
              <div
                data-href={href}
                className={`rounded-xl border border-line bg-raised p-4 shadow-raised transition-[background-color,transform] ${href ? "card-rows relative active:scale-[0.99] active:bg-hover" : ""}`}
              >
                {href && (
                  <RowLink href={href} className="absolute inset-0 rounded-xl" />
                )}
                <div>
                  {/* «كم؟» في سطر العنوان مقابل الاسم — كان المبلغُ خانةً بين الخانات بخطّ ١٢ */}
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 flex-1 text-sm font-bold leading-snug">{primary.cell(row)}</p>
                    {amount && (
                      <p className="shrink-0 text-end">
                        <span className="block text-[11px] text-muted">{amount.header}</span>
                        <span className="block text-[15px] font-bold leading-snug">{amount.cell(row)}</span>
                      </p>
                    )}
                  </div>
                  {main.length > 0 && (
                    <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
                      {main.map((c) => (
                        <div key={c.key} className="min-w-0">
                          <dt className="text-[11px] text-muted">{c.header}</dt>
                          <dd className={c.wrap ? "text-xs" : "truncate text-xs"}>{c.cell(row)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {/* الثانويُّ (ما يُخفى في الجدول الضيّق) يُطوى هنا — لا يزاحم ما يُقرأ أوّلاً */}
                  {extra.length > 0 && (
                    <details className="mt-2">
                      <summary className="inline-flex min-h-9 cursor-pointer list-none items-center text-[11px] font-bold text-ink-soft [&::-webkit-details-marker]:hidden">
                        المزيد
                      </summary>
                      <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-2">
                        {extra.map((c) => (
                          <div key={c.key} className="min-w-0">
                            <dt className="text-[11px] text-muted">{c.header}</dt>
                            <dd className={c.wrap ? "text-xs" : "truncate text-xs"}>{c.cell(row)}</dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
