import Link from "next/link";
import {
  ArrowDown, ArrowLeft, ArrowUp, BookOpen, Check, ClipboardList, Equal, FileSpreadsheet, Minus, Plus, Scale,
  type LucideIcon,
} from "lucide-react";
import { Stepper, buttonClass, type Tone } from "./ui";
import { Money } from "./money";
import { PRODUCT, countNoun, type NounForms } from "@/lib/arabic";
import { formatDay } from "@/lib/riyadh-time";

/**
 * عناصرُ مساحة الجرد — تُرسَم في الخادم وتصلح للمتصفّح (لا قاعدةَ فيها).
 *
 * ما يتكرّر بين شاشات الجرد يُرسَم هنا مرّةً: تسميةُ الأسبوع، وطريقُ
 * البداية بخطواته الثلاث، والمعادلةُ التي يُحسَب بها الفرق، وجهتا الفرق
 * — لأنّ النقصَ والزيادةَ إن رُسما في كلّ شاشةٍ بيدٍ اختلفا لوناً ومعنى.
 */

/* ─────────────────────────── التمييز ─────────────────────────── */

/* ما يُعَدّ في هذه المساحة وحدها — ويُرفَع إلى `arabic.ts` إن احتاجه غيرها */
export const RECIPE: NounForms = { one: "وصفة واحدة", two: "وصفتان", few: "وصفات", many: "وصفة", zero: "لا وصفات" };
export const COUNT: NounForms = { one: "جرد واحد", two: "جردان", few: "جردات", many: "جرداً", zero: "لا جرد" };
export const WEEK: NounForms = { one: "أسبوع واحد", two: "أسبوعان", few: "أسابيع", many: "أسبوعاً", zero: "لا أسابيع" };
export const UNIT_SOLD: NounForms = { one: "وحدة واحدة", two: "وحدتان", few: "وحدات", many: "وحدة", zero: "لا وحدات" };

/* ─────────────────────────── خطواتُ الجرد ─────────────────────────── */

/*
  هنا لا في ملفّ الخطوات: ذاك ملفُّ متصفّح، والصفحةُ تقرأ `?step=` في
  الخادم — ودالّةٌ من ملفّ متصفّح لا تُستدعى في الخادم.
*/
export type StepId = "scope" | "flow" | "count" | "review" | "close";
export const STEP_ORDER: readonly StepId[] = ["scope", "flow", "count", "review", "close"];

export function isStepId(v: unknown): v is StepId {
  return typeof v === "string" && (STEP_ORDER as readonly string[]).includes(v);
}

/* ─────────────────────────── الأسبوع ─────────────────────────── */

const DAY_MONTH = new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", { timeZone: "UTC", day: "numeric", month: "long" });
const DAY_ONLY = new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", { timeZone: "UTC", day: "numeric" });
const MONTH_YEAR = new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", { timeZone: "UTC", month: "long", year: "numeric" });

function utc(day: string): Date {
  return new Date(`${day}T12:00:00Z`);
}

/**
 * «١٣–١٩ سبتمبر ٢٠٢٦» — الأسبوعُ يُقرأ بأيّامه لا بتاريخين آليّين.
 *
 * كانت الفترةُ تُكتب `2026-09-13 → 2026-09-19`: سهمٌ يشير يساراً في سطرٍ
 * يُقرأ من اليمين، وسنةٌ مكرَّرة. والشهرُ يُذكر مرّةً إن لم يتغيّر.
 */
export function formatWeek(start: string, end: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return `${start} – ${end}`;
  if (start === end) return formatDay(start);
  const a = utc(start);
  const b = utc(end);
  if (start.slice(0, 7) === end.slice(0, 7)) {
    return `${DAY_ONLY.format(a)}–${DAY_ONLY.format(b)} ${MONTH_YEAR.format(b)}`;
  }
  const year = end.slice(0, 4);
  return start.slice(0, 4) === year
    ? `${DAY_MONTH.format(a)} – ${DAY_MONTH.format(b)} ${year}`
    : `${formatDay(start)} – ${formatDay(end)}`;
}

/* ─────────────────────────── جهةُ الفرق ─────────────────────────── */

/**
 * النقصُ والزيادةُ جهتان لا إشارتان — لكلٍّ لونُه ورمزُه وكلمتُه.
 *
 * والزيادةُ ليست خبراً سارّاً فلا تُلوَّن أخضر: هي شراءٌ لم يُقيَّد أو
 * عدٌّ يُراجَع. والأخضرُ للمطابقة وحدها.
 */
export type Direction = "short" | "over" | "even";

export function directionOf(milli: number | null): Direction | null {
  if (milli === null) return null;
  return milli < 0 ? "short" : milli > 0 ? "over" : "even";
}

export const DIRECTION: Record<Direction, { label: string; tone: Tone; icon: LucideIcon; text: string; bar: string }> = {
  short: { label: "نقص", tone: "danger", icon: ArrowDown, text: "text-danger", bar: "bg-danger" },
  over: { label: "زيادة", tone: "info", icon: ArrowUp, text: "text-info", bar: "bg-info" },
  even: { label: "مطابق", tone: "ok", icon: Check, text: "text-ok", bar: "bg-ok" },
};

export function DirectionTag({ milli }: { milli: number | null }) {
  const d = directionOf(milli);
  if (!d) return <span className="text-[11px] text-muted">لم يُحسَب</span>;
  const s = DIRECTION[d];
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-bold ${s.text}`}>
      <s.icon className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
      {s.label}
    </span>
  );
}

/** شريطُ مقدارٍ نسبيّ — طولُه من الأكبر في القائمة، ولونُه جهتُه. */
export function MagnitudeBar({ value, max, direction }: { value: number; max: number; direction: Direction }) {
  const pct = max > 0 ? Math.max(3, Math.min(100, (Math.abs(value) / max) * 100)) : 0;
  return (
    <span aria-hidden className="block h-1.5 w-full overflow-hidden rounded-full bg-sunken">
      <span className={`block h-full rounded-full ${DIRECTION[direction].bar}`} style={{ width: `${pct}%` }} />
    </span>
  );
}

/**
 * النقصُ والزيادةُ متجاوران — لا صافٍ يقودهما.
 *
 * نقصٌ بألفٍ وزيادةٌ بألف صافيهما صفر، وليس ذلك «لا مشكلة». فيُرسَمان
 * لوحين متساويين، ولكلٍّ عددُ أصنافه. و`null` «غير معروف» لا صفر.
 */
export function VarianceSplit({
  shortage,
  overage,
  linesShort,
  linesOver,
  showAmounts,
  measured,
  foot,
}: {
  shortage: number;
  overage: number;
  linesShort: number;
  linesOver: number;
  showAmounts: boolean;
  /** أحُسب فرقُ صنفٍ واحدٍ على الأقلّ؟ وإلّا فالمجموعان مجهولان. */
  measured: boolean;
  foot?: React.ReactNode;
}) {
  const side = (d: "short" | "over", minor: number, lines: number, hint: string) => {
    const s = DIRECTION[d];
    return (
      <div className={`relative overflow-hidden rounded-2xl border bg-raised p-4 shadow-raised sm:p-5 ${d === "short" ? "border-danger/25" : "border-info/25"}`}>
        <span aria-hidden className={`absolute inset-y-0 start-0 w-1 ${s.bar}`} />
        <p className={`flex items-center gap-1.5 text-xs font-bold ${s.text}`}>
          <span className={`grid h-6 w-6 place-items-center rounded-md ${d === "short" ? "bg-danger-bg" : "bg-info-bg"}`}>
            <s.icon className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
          </span>
          {d === "short" ? "النقص" : "الزيادة"}
        </p>
        <p className="mt-3 text-[1.7rem] font-bold leading-none tracking-tight sm:text-[2rem]">
          {!measured ? (
            <span className="text-[1.25rem] text-muted">غير معروف</span>
          ) : showAmounts ? (
            <Money minor={minor} currency />
          ) : (
            <span className="nums">{countNoun(lines, PRODUCT)}</span>
          )}
        </p>
        <p className="mt-2.5 text-xs leading-relaxed text-muted">
          {!measured ? "لم يُحسَب فرقُ صنفٍ بعد — يُحسَب لكلّ ما عُدّ وعُرفت حدودُ معادلته." : (
            <>
              {lines === 0 ? (d === "short" ? "لا صنفَ وُجد منه أقلّ من المتوقَّع." : "لا صنفَ وُجد منه أكثر من المتوقَّع.") : (
                <><span className="font-bold text-ink-soft">{countNoun(lines, PRODUCT)}</span> {hint}</>
              )}
            </>
          )}
        </p>
      </div>
    );
  };

  return (
    <div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
        {side("short", shortage, linesShort, "وُجد منه أقلّ من المتوقَّع.")}
        {side("over", overage, linesOver, "وُجد منه أكثر — شراءٌ لم يُقيَّد أو عدٌّ يُراجَع.")}
      </div>
      {foot && <div className="mt-3">{foot}</div>}
    </div>
  );
}

/* ─────────────────────────── المعادلة ─────────────────────────── */

/**
 * المعادلةُ التي يُحاسَب بها الجرد — مرسومةً لا مكتوبةً فقرة.
 *
 * من رآها قبل أن يعدّ عرف أنّ الفرقَ فرقٌ بين رقمين محسوبين، لا حكمٌ
 * ينزل عليه — وعرف أين يقع ما لم يُعرَف بعد.
 */
export function EquationExplainer({ compact = false }: { compact?: boolean }) {
  const terms: { icon: LucideIcon; label: string; from: string; op?: LucideIcon }[] = [
    { icon: ClipboardList, label: "ما كان على الرفّ", from: "جردُ الأسبوع السابق أو رصيدٌ تُدخله" },
    { icon: FileSpreadsheet, label: "ما دخل", from: "فواتيرُ المورّدين وما تُدخله يدوياً", op: Plus },
    { icon: BookOpen, label: "ما صُرف", from: "مبيعاتُ فودكس × الوصفات", op: Minus },
    { icon: Scale, label: "المتوقَّع على الرفّ", from: "يُقابَل بما عددتَه فيخرج الفرق", op: Equal },
  ];
  return (
    <ol className={`grid grid-cols-2 gap-2 ${compact ? "lg:grid-cols-4" : ""}`} aria-label="كيف يُحسَب فرقُ الجرد">
      {terms.map((t, i) => (
        <li key={t.label} className="relative flex flex-col items-start gap-2 rounded-xl border border-line bg-raised px-3 py-2.5 sm:flex-row sm:gap-2.5">
          <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${i === 3 ? "bg-accent text-accent-ink" : "bg-sunken text-ink-soft"}`}>
            <t.icon className="h-4 w-4" strokeWidth={2} aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1 text-[13px] font-bold">
              {t.op && <t.op className="h-3.5 w-3.5 text-muted" strokeWidth={2.5} aria-label={t.op === Plus ? "زائد" : t.op === Minus ? "ناقص" : "يساوي"} />}
              {t.label}
            </span>
            <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">{t.from}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/* ─────────────────────────── طريقُ البداية ─────────────────────────── */

export interface JourneyFacts {
  stockItems: number;
  recipes: number;
  sales: number;
  salesThrough: string | null;
  counts: number;
}

/**
 * الخطواتُ الثلاث بترتيبها — كتالوج ← مبيعات ← جرد.
 *
 * وكلُّ خطوةٍ تقول بم تمّت إن تمّت، وما يفعلها إن لم تتمّ، والتي عليها
 * الدورُ وحدها بزرٍّ رئيسيّ. ولا صفرَ في الشاشة: «لا وصفةَ بعد» جملةٌ
 * تقول ما ينقص، و«٠ وصفة» رقمٌ يُقرأ جواباً.
 */
export function SetupJourney({
  facts,
  countHref = "#start",
}: {
  facts: JourneyFacts;
  /** أين يبدأ الجرد — في «الجرد الحالي» مرساةٌ إلى بطاقته. */
  countHref?: string;
}) {
  const done = { catalog: facts.recipes > 0, sales: facts.sales > 0, count: facts.counts > 0 };
  const next = !done.catalog ? "catalog" : !done.sales ? "sales" : !done.count ? "count" : null;
  const state = (id: keyof typeof done) => (done[id] ? "done" : next === id ? "current" : "todo") as "done" | "current" | "todo";
  const button = (id: keyof typeof done, href: string, label: string) => (
    <Link href={href} className={buttonClass(next === id ? "primary" : "secondary", "sm")}>
      {label}
      {next === id && <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />}
    </Link>
  );
  /*
    على الجوّال يقع الزرُّ تحت الجملة لا بجانبها — بجانبها يعصر الجملةَ في
    عمودٍ بعرض كلمتين. وعلى الحاسوب بجانبها حيث تبلغه العين.
  */
  const action = (id: keyof typeof done, href: string, label: string) =>
    done[id] ? undefined : <span className="hidden sm:block">{button(id, href, label)}</span>;
  const detail = (id: keyof typeof done, text: string, href: string, label: string) => (
    <>
      {text}
      {!done[id] && <span className="mt-2.5 block sm:hidden">{button(id, href, label)}</span>}
    </>
  );

  return (
    <Stepper
      steps={[
        {
          id: "catalog",
          title: "ارفع كتالوج فودكس",
          state: state("catalog"),
          detail: detail("catalog", done.catalog
            ? `${countNoun(facts.stockItems, PRODUCT)} مخزون · ${countNoun(facts.recipes, RECIPE)}`
            : `ثلاثةُ ملفّاتٍ معاً: أصنافُ المخزون، والأصنافُ المباعة، والوصفات. تُنشئ الوصفاتِ والربطَ دفعةً واحدة${facts.stockItems > 0 ? ` — وعندك ${countNoun(facts.stockItems, PRODUCT)} مخزونٍ من الفواتير بلا وصفة` : ""}.`,
          "/inventory/import#catalog", "ارفع الكتالوج"),
          action: action("catalog", "/inventory/import#catalog", "ارفع الكتالوج"),
        },
        {
          id: "sales",
          title: "ارفع ملفّ مبيعات الأسبوع",
          state: state("sales"),
          detail: detail("sales", done.sales
            ? `المبيعاتُ مستورَدةٌ حتى ${formatDay(facts.salesThrough)}`
            : "تصديرُ فودكس (Excel) كما هو — منه يُحسَب ما كان ينبغي أن يُصرَف. ولا يُفترَض رقمُ مبيعاتٍ عن غير ملفّ.",
          "/inventory/import#sales", "ارفع المبيعات"),
          action: action("sales", "/inventory/import#sales", "ارفع المبيعات"),
        },
        {
          id: "count",
          title: "ابدأ جردَ الأسبوع",
          state: state("count"),
          detail: detail("count", done.count ? "بدأتَ جرداً من قبل — والسجلُّ يحفظ كلَّ ما أُقفل." : "تختار ما تعدّه، ثمّ تُدخل ما وجدتَه على الرفّ — والباقي محسوب.", countHref, "ابدأ الجرد"),
          action: action("count", countHref, "ابدأ الجرد"),
        },
      ]}
    />
  );
}

/* ─────────────────────────── حقيقةٌ صغيرة ─────────────────────────── */

/**
 * بطاقةُ حقيقةٍ واحدة — عددٌ أو جملة، ومعها وجهتُها.
 *
 * والفراغُ جملةٌ لا صفر: «لا وصفةَ بعد» تقول ما ينقص.
 */
export function FactTile({
  icon: Icon,
  label,
  value,
  sub,
  href,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  href?: string;
  tone?: "warn" | "muted";
}) {
  const body = (
    <>
      <span className="flex items-center gap-2 text-xs font-bold text-muted">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-sunken text-ink-soft transition-colors group-hover:bg-accent-soft group-hover:text-accent">
          <Icon className="h-4 w-4" strokeWidth={2} aria-hidden />
        </span>
        {label}
      </span>
      <span className={`mt-3 block text-lg font-bold leading-tight ${tone === "warn" ? "text-warn" : tone === "muted" ? "text-muted" : ""}`}>{value}</span>
      {sub && <span className="mt-1 block text-[11px] leading-relaxed text-muted">{sub}</span>}
    </>
  );
  const cls = "group flex h-full flex-col rounded-xl border border-line bg-raised p-4 shadow-raised";
  return href ? (
    <Link href={href} className={`${cls} transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:border-accent-line hover:shadow-lifted`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
