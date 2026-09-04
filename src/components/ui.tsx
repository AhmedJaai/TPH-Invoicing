import Link from "next/link";
import { Money } from "./money";

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
  title,
  hint,
  action,
  children,
  className = "",
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`mt-8 sm:mt-10 ${className}`}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-display text-lg font-bold leading-tight">{title}</h2>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {hint && <p className="mb-3 max-w-2xl text-xs leading-relaxed text-muted">{hint}</p>}
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
  const pad = size === "sm" ? "px-3 py-1.5 text-[11px]" : "px-4 py-2.5 text-sm";
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
    <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold ${cls}`}>
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
        <p className="text-[11px] font-medium text-muted">{label}</p>
        <p className={`nums mt-2 font-display text-2xl font-bold leading-none sm:text-[1.75rem] ${tone ? TONE_TEXT[tone] : ""}`}>
          {minor !== undefined ? <Money minor={minor} /> : value}
        </p>
        {sub && <p className="mt-2 text-[11px] leading-relaxed text-muted">{sub}</p>}
      </div>
    </Card>
  );
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

export function ErrorState({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-danger/40 bg-danger-bg px-5 py-8 text-center">
      <p className="text-sm font-bold text-danger">{message}</p>
      {hint && <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-ink-soft">{hint}</p>}
    </div>
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
  /** عمودٌ ثانويّ يُخفى على الشاشات الضيّقة داخل الجدول. */
  secondary?: boolean;
  /** عنوان البطاقة على الجوّال — يُعرَض بارزاً بلا تسمية. */
  primary?: boolean;
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
    return <>{empty ?? <EmptyState title="لا شيء هنا بعد." />}</>;
  }

  const primary = columns.find((c) => c.primary) ?? columns[0];
  const rest = columns.filter((c) => c !== primary);

  return (
    <>
      {/* الحاسوب: جدول */}
      <div className="scroll-x hidden rounded-2xl border border-line shadow-raised sm:block">
        <table className="w-full text-xs">
          <thead className="bg-sunken text-muted">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`whitespace-nowrap px-3 py-2.5 font-medium ${
                    c.align === "end" ? "text-end" : "text-start"
                  } ${c.secondary ? "hidden lg:table-cell" : ""}`}
                >
                  {c.header}
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
                    className={`px-3 py-2.5 align-top ${c.align === "end" ? "text-end" : "text-start"} ${
                      c.secondary ? "hidden lg:table-cell" : ""
                    }`}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* الجوّال: بطاقات */}
      <ul className="space-y-2.5 sm:hidden">
        {rows.map((row) => {
          const href = hrefOf?.(row);
          const body = (
            <>
              <p className="text-sm font-bold leading-snug">{primary.cell(row)}</p>
              <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5">
                {rest.map((c) => (
                  <div key={c.key} className="min-w-0">
                    <dt className="text-[10px] text-muted">{c.header}</dt>
                    <dd className="truncate text-xs">{c.cell(row)}</dd>
                  </div>
                ))}
              </dl>
            </>
          );
          return (
            <li key={keyOf(row)}>
              <Card href={href}>{body}</Card>
            </li>
          );
        })}
      </ul>
    </>
  );
}
