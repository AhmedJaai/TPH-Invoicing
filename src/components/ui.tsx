import Link from "next/link";
import { Money, Prose } from "./money";
import { ScrollX } from "./scroll-x";

/**
 * عناصر الواجهة المشتركة.
 *
 * كانت كل صفحة تكتب بطاقتها وجدولها وحالتها الفارغة بنفسها، فاختلفت
 * المسافات والحدود ومقاسات الخطّ بين صفحة وأخرى — وهو ما يجعل التطبيق
 * يبدو أداةً داخلية لا منتجاً. هذه الملفّ يوحّدها.
 *
 * كلّها عناصر عرض بلا حالة، فتصلح للخادم. وما يحتاج تفاعلاً في
 * `ui-client.tsx`.
 */

/* ─────────────────────────── الطبقات ─────────────────────────── */

export type Tone = "warn" | "danger" | "ok" | "muted";

export const TONE_TEXT: Record<Tone, string> = {
  warn: "text-warn",
  danger: "text-danger",
  ok: "text-ok",
  muted: "text-muted",
};

const TONE_SURFACE: Record<Tone, string> = {
  warn: "border-warn/40 bg-warn-bg",
  danger: "border-danger/40 bg-danger-bg",
  ok: "border-ok/40 bg-ok-bg",
  muted: "border-line bg-sunken",
};

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
  const base = `rounded-2xl border shadow-raised ${padded ? "p-4 sm:p-5" : ""} ${
    tone ? TONE_SURFACE[tone] : "border-line bg-raised"
  } ${className}`;

  if (!href) return <div className={base}>{children}</div>;
  return (
    <Link
      href={href}
      className={`${base} block transition-all hover:border-ink-soft hover:shadow-lifted`}
    >
      {children}
    </Link>
  );
}

/**
 * عنوان قسم مع فعله.
 *
 * الفعل بجانب العنوان لا في ذيل القسم: من يقرأ العنوان يعرف فوراً ماذا
 * يستطيع أن يفعل، ولا ينزل ليبحث.
 */
export function Section({
  id,
  title,
  hint,
  action,
  children,
  className = "",
}: {
  /** مرساةٌ يهبط إليها رابطٌ من تنبيه — فالعدد يفتح سجلّه لا رأس الصفحة. */
  id?: string;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`mt-8 sm:mt-10 ${className}`}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-display text-lg font-bold leading-tight">{title}</h2>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {hint && (
        <p className="mb-3 max-w-2xl text-xs leading-relaxed text-muted">
          <Prose text={hint} />
        </p>
      )}
      {children}
    </section>
  );
}

/* ─────────────────────────── الأفعال ─────────────────────────── */

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

export const BUTTON_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-inverse-surface text-inverse-ink hover:opacity-90",
  secondary: "border border-line hover:border-ink-soft",
  quiet: "text-ink-soft hover:bg-sunken",
  danger: "border border-danger/50 text-danger hover:bg-danger-bg",
};

export function buttonClass(variant: ButtonVariant = "secondary", size: "sm" | "md" = "md") {
  /*
    ارتفاعُ اللمس ٤٤ بكسل على الجوّال — كان زرّ «sm» ٢٨ بكسلاً في كلّ أزرار
    الطابور، وأحمد يضغطها بإبهامه عند الكاشير. وعلى الحاسوب يبقى مضغوطاً.
  */
  const pad = size === "sm"
    ? "min-h-11 px-3 py-1.5 text-[11px] sm:min-h-0"
    : "min-h-11 px-4 py-2.5 text-sm";
  return `inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl font-bold transition-all disabled:opacity-50 ${pad} ${BUTTON_CLASS[variant]}`;
}

export function LinkButton({
  href,
  variant = "secondary",
  size = "md",
  children,
  className = "",
}: {
  href: string;
  variant?: ButtonVariant;
  size?: "sm" | "md";
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link href={href} className={`${buttonClass(variant, size)} ${className}`}>
      {children}
    </Link>
  );
}

export function Badge({
  tone,
  children,
}: {
  tone?: Tone;
  children: React.ReactNode;
}) {
  const cls = tone
    ? `${TONE_SURFACE[tone]} ${TONE_TEXT[tone]}`
    : "border-line bg-sunken text-ink-soft";
  return (
    <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-bold ${cls}`}>
      {children}
    </span>
  );
}

/* ─────────────────────────── الأرقام ─────────────────────────── */

/**
 * رقمٌ في بطاقة.
 *
 * الرقم أوّلاً وأكبر، والوصف تحته أصغر: العين تقرأ الحجم قبل الترتيب.
 * وحين يكون له وجهة يصير كلّه قابلاً للنقر، لا كلمةً صغيرة في ذيله.
 */
export function Stat({
  label,
  value,
  minor,
  sub,
  tone,
  href,
}: {
  label: string;
  value?: React.ReactNode;
  minor?: number;
  sub?: React.ReactNode;
  tone?: Tone;
  href?: string;
}) {
  return (
    <Card href={href} padded={false}>
      <div className="px-4 py-3.5 sm:px-5 sm:py-4">
        <p className="text-xs font-medium text-muted">{label}</p>
        {/*
          `.nums` يخطّ بخطّ النظام — فيوضع على الرقم وحده. كان على الحاوية،
          فكُتبت «غير معروف» و«لم يصل» بخطٍّ غير خطّ الواجهة.
        */}
        <p className={`${isNumeric(value) ? "nums " : ""}mt-2 font-display text-2xl font-bold leading-none sm:text-[1.75rem] ${tone ? TONE_TEXT[tone] : ""}`}>
          {minor !== undefined ? <Money minor={minor} /> : value}
        </p>
        {sub && (
          <p className="mt-2 text-xs leading-relaxed text-muted">
            {typeof sub === "string" ? <Prose text={sub} /> : sub}
          </p>
        )}
      </div>
    </Card>
  );
}

/** قيمةٌ نصّها أرقامٌ صرفة — وحدها تستحقّ خطّ الأرقام. */
export function isNumeric(value: React.ReactNode): boolean {
  return typeof value === "number" || (typeof value === "string" && /^[\d\s.,٫٬%٪+\-/]+$/.test(value));
}

export function StatGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">{children}</div>;
}

/* ─────────────────────────── الحالات ─────────────────────────── */

/**
 * الفراغ يقول ما الذي يملؤه.
 *
 * «لا بيانات» تترك القارئ واقفاً؛ الفراغ النافع يقول لماذا هو فارغ وما
 * الخطوة التي تملؤه.
 */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-5 py-12 text-center">
      <p className="text-sm font-bold">{title}</p>
      {hint && <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-muted">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/**
 * صفحةٌ خارج الصلاحية.
 *
 * كانت أربع عشرة صياغةً لمعنىً واحد — «محجوبة عن دورك» و«دورك لا يشمل
 * الأرقام المالية» و«للمالك وحده» — ولا واحدةٌ منها تقول **لمن يُطلَب
 * الإذن**. فالقارئ يعرف أنّه ممنوع ولا يعرف كيف يُسمَح له.
 */
export function NoAccess({ what }: { what?: string }) {
  return (
    <EmptyState
      title={what ? `${what} خارج صلاحيتك.` : "هذه الصفحة خارج صلاحيتك."}
      hint="اطلب من مالك الحساب توسيع صلاحيتك، ثمّ حدّث الصفحة."
    />
  );
}

/** هيكل الانتظار: يدلّ على أين سيقع المحتوى، بلا نسبة مخترَعة. */
export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton h-12" />
      ))}
      <span className="sr-only">يُحمّل…</span>
    </div>
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
   * عمود مال أو عدد — تصطفّ فواصله على خطٍّ واحد.
   *
   * يسبق `align`: المال يُصفّ على آخر خانةٍ منه لا على جهةٍ من الجدول،
   * فلا يصحّ فيه `start` ولا `end` وإنّما اليمين الفيزيائيّ.
   */
  numeric?: boolean;
  /** عمودٌ ثانويّ يُخفى على الشاشات الضيّقة داخل الجدول. */
  secondary?: boolean;
  /** عنوان البطاقة على الجوّال — يُعرَض بارزاً بلا تسمية. */
  primary?: boolean;
  /**
   * خليّةٌ لا تُقصّ على الجوّال.
   *
   * القصُّ (`truncate`) يضع `overflow: hidden` على الخليّة — وذلك
   * صحيحٌ لنصٍّ طويل، ويبتلع **لوحَ إقرارٍ يُفتَح داخلها**: فيضغط
   * صاحبُه «احذف» فلا يرى ما يؤكّد به. فما كانت خليّتُه فعلاً لا نصّاً
   * تُعلَن هنا.
   */
  wrap?: boolean;
}

/**
 * جدول يصير بطاقات على الجوّال.
 *
 * جدولٌ بعشرة أعمدة يُسحب عرضاً على شاشة الجوّال ليس جدولاً بل عقوبة.
 * وعلى الشاشة الضيّقة يصير كلّ صفٍّ بطاقةً: العنوان بارزاً، وكلّ حقلٍ
 * باسمه وقيمته. البيانات نفسها، والعرض يتبع الشاشة.
 */
export function DataTable<T>({
  columns,
  rows,
  keyOf,
  empty,
  hrefOf,
}: {
  columns: readonly Column<T>[];
  rows: readonly T[];
  keyOf: (row: T) => string;
  empty?: React.ReactNode;
  hrefOf?: (row: T) => string | undefined;
}) {
  if (rows.length === 0) {
    /*
      الفراغ الافتراضيّ يقول ما يملؤه — وهو الذي يظهر حيث لم تُكتب حالةٌ
      خاصّة، أي في المواضع التي لم يُفكَّر فيها. و«لا شيء هنا بعد» وحدها
      تترك القارئ واقفاً لا يدري أهو عطبٌ أم ترتيبٌ صحيح.
    */
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

  return (
    <>
      {/* الحاسوب: جدول */}
      <ScrollX className="hidden rounded-2xl border border-line shadow-raised sm:block">
        <table className="w-full text-xs">
          <thead className="bg-sunken text-muted">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`whitespace-nowrap px-3 py-2.5 font-medium ${
                    /* رأسُ عمود المال على جهة آخر خانةٍ منه — وهي في العربية جهة البدء */
                    c.numeric ? "text-start" : c.align === "end" ? "text-end" : "text-start"
                  } ${c.secondary ? "hidden lg:table-cell" : ""}`}
                >
                  {/* عمودُ الأفعال بلا عنوانٍ مرئيّ — ولقارئ الشاشة اسمُه، لا رأسٌ صامت */}
                  {c.header || <span className="sr-only">الفعل</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={keyOf(row)} className="transition-colors hover:bg-sunken/60">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-3 py-2.5 align-top ${
                      c.numeric ? "nums-col" : c.align === "end" ? "text-end" : "text-start"
                    } ${c.secondary ? "hidden lg:table-cell" : ""}`}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollX>

      {/*
        ── الجوّال: بطاقات، ورابطُ البطاقة طبقةٌ لا غلاف ──

        كانت البطاقة كلُّها `<Link>` يلفّ خلاياها. فأيُّ خليّةٍ فيها
        رابطٌ تُنتج `<a>` داخل `<a>` — وهو ترميزٌ باطل يرفضه المتصفّح
        فيعيد بناء الشجرة، **ويسقط الترطيب فيتوقّف تفاعلُ الصفحة
        كلّها**. وقد وقع حين صارت شارةُ الضريبة تفتح سببَها.

        والعلاج أنّ الرابط طبقةٌ مطلقة تحت المحتوى لا غلافٌ حوله:
        الضغطُ على الفراغ يبلغها، والضغطُ على رابطٍ داخليّ يبلغه هو —
        لأنّ المحتوى يُرسَم بعدها فيعلوها. ولا `<a>` داخل `<a>`.
      */}
      <ul className="space-y-2.5 sm:hidden">
        {rows.map((row) => {
          const href = hrefOf?.(row);
          return (
            <li key={keyOf(row)}>
              <Card className={href ? "relative card-rows" : ""}>
                {href && (
                  <Link
                    href={href}
                    aria-label="افتح التفصيل"
                    className="absolute inset-0 rounded-2xl"
                  />
                )}
                <div>
                  <p className="text-sm font-bold leading-snug">{primary.cell(row)}</p>
                  <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5">
                    {rest.map((c) => (
                      <div key={c.key} className="min-w-0">
                        <dt className="text-[11px] text-muted">{c.header}</dt>
                        <dd className={c.wrap ? "text-xs" : "truncate text-xs"}>{c.cell(row)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </>
  );
}
