"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CircleAlert, FlaskConical, Repeat, RotateCcw, Store } from "lucide-react";
import { Money } from "./money";
import { buttonClass } from "./ui-tokens";
import { toast } from "./ui-client";
import { LATER_BUCKET, whatIfDefer, type OutlookBucket } from "@/lib/cash-outlook";
import { parseSelection, rawSelection, saveSelection } from "@/lib/pay-run-selection";
import { SUPPLIER, countNoun } from "@/lib/arabic";

/**
 * «ما يخرج، ومتى» — الجدولُ الزمنيّ ورسمُه، وفيه «ماذا لو أجّلتُ هذا؟».
 *
 * مربّعٌ بجانب كلّ سطرٍ ينقله إلى المرحلة التالية، فيُعاد «يبقى بعدها» لكلّ مرحلة
 * في المتصفّح (`whatIfDefer`: جمعٌ وطرحُ أعدادٍ صحيحة من أرقام الخادم نفسها). وهي
 * **تجربةٌ لا قيد** ويُقال ذلك ما دامت قائمة. و«اعتمد هذا الترتيب» ينقل ما أُجِّل
 * من مورّدي الدفعة المتأخّرة استثناءً في «دفعة الشهر» — حيث يُبنى الملفُّ في الخادم.
 */

const DOT = { danger: "bg-danger", warn: "bg-warn", neutral: "bg-accent" } as const;

export function CashTimeline({
  buckets,
  balanceMinor,
  runMonth,
  canPay,
}: {
  buckets: OutlookBucket[];
  /** آخرُ رصيدٍ معروف — `null` مجهول، فلا خطَّ ولا «يبقى بعدها». */
  balanceMinor: number | null;
  /** شهرُ الدفعة المتأخّرة — به يُحفَظ الاستثناءُ في «دفعة الشهر». */
  runMonth: string;
  canPay: boolean;
}) {
  const router = useRouter();
  const [deferred, setDeferred] = useState<Set<string>>(new Set());
  const view = useMemo(() => whatIfDefer(buckets, balanceMinor, deferred), [buckets, balanceMinor, deferred]);
  const trying = deferred.size > 0;
  /* أين كان السطرُ أصلاً — ليُعلَّم «مؤجَّلٌ من…» في مرحلته الجديدة */
  const origin = useMemo(() => new Map(buckets.flatMap((b) => b.lines.map((l) => [l.id, b.title] as const))), [buckets]);
  /* ما يُنقَل إلى «دفعة الشهر»: مورّدو الدفعة المتأخّرة وحدهم (`run:<معرّف>`) */
  const deferredSuppliers = [...deferred].flatMap((id) => (id.startsWith("run:") ? [id.slice(4)] : []));

  function toggle(id: string) {
    setDeferred((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function adopt() {
    const current = parseSelection(rawSelection(runMonth));
    saveSelection(runMonth, { ...current, skipSuppliers: [...new Set([...current.skipSuppliers, ...deferredSuppliers])] });
    toast({
      tone: "ok",
      title: `استُثني ${countNoun(deferredSuppliers.length, SUPPLIER)} من دفعة الشهر`,
      body: "لم يُحوَّل شيء ولم يُقيَّد — راجع الدفعة ثمّ نزّل ملفَّها.",
    });
    router.push("/payments");
  }

  return (
    <>
      {balanceMinor !== null && <BalanceSteps balanceMinor={balanceMinor} buckets={view.buckets} />}

      {trying && (
        <div role="status" className="sticky top-14 z-10 mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-info/30 bg-info-bg px-4 py-3 text-xs lg:top-[60px]">
          <FlaskConical className="h-4 w-4 shrink-0 text-info" strokeWidth={2} aria-hidden />
          <p className="min-w-0 flex-1 basis-56 leading-relaxed text-ink-soft">
            <b className="text-ink">تجربة — لم يُحفظ شيء.</b> أجّلتَ <Money minor={view.deferredMinor} /> إلى المرحلة التالية
            {view.lowestMinor !== null && (
              <> · أدنى ما يبلغه الرصيد <b className={view.lowestMinor < 0 ? "text-danger" : "text-ink"}><Money minor={view.lowestMinor} /></b></>
            )}
            {view.shortfallAt === null && balanceMinor !== null ? " · لا يقصر الرصيدُ المعروف بهذا الترتيب." : ""}
          </p>
          <button type="button" onClick={() => setDeferred(new Set())} className={buttonClass("quiet", "sm")}>
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            ألغِ التجربة
          </button>
          {canPay && deferredSuppliers.length > 0 && (
            <button type="button" onClick={adopt} className={buttonClass("primary", "sm")}>
              اعتمد هذا الترتيب في دفعة الشهر
            </button>
          )}
        </div>
      )}

      <ol className="relative space-y-4">
        {view.buckets.map((b, i) => (
          <li key={b.id} className="relative ps-8">
            {i < view.buckets.length - 1 && <span aria-hidden className="absolute start-[11px] top-6 -bottom-4 w-px bg-line" />}
            <span aria-hidden className={`absolute start-1 top-1.5 h-4 w-4 rounded-full border-4 border-surface ${DOT[b.tone]}`} />
            <article className="overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
              <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line-soft px-4 py-3.5 sm:px-5">
                <div className="min-w-0">
                  <h3 className="text-[15px] font-bold">{b.title}</h3>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted">{b.when}</p>
                </div>
                <div className="text-end">
                  <p className="text-lg font-bold"><Money minor={b.totalMinor} /></p>
                  {b.afterMinor !== null && (
                    <p className={`mt-0.5 text-[11px] ${b.afterMinor < 0 ? "font-bold text-danger" : "text-muted"}`}>
                      يبقى بعدها ≥ <Money minor={b.afterMinor} />
                    </p>
                  )}
                </div>
              </header>
              {view.shortfallAt === b.id && (
                <p className="flex items-center gap-2 bg-danger-bg px-4 py-2 text-xs font-bold text-danger sm:px-5">
                  <CircleAlert className="h-4 w-4" strokeWidth={2} aria-hidden />
                  هنا يقصر الرصيدُ المعروف عمّا يخرج{trying ? " — بترتيب التجربة." : " — جرّب تأجيلَ سطرٍ بمربّعه."}
                </p>
              )}
              {b.lines.length === 0 ? (
                <p className="px-4 py-3 text-xs text-muted sm:px-5">أجّلتَ كلَّ ما فيها.</p>
              ) : (
                <ul className="divide-y divide-line-soft">
                  {b.lines.map((l) => {
                    const moved = deferred.has(l.id);
                    return (
                      <li key={l.id} className="flex min-h-12 items-center gap-1 pe-4 sm:pe-5">
                        {/* المربّعُ هدفُ لمسٍ ٤٤ بكسلاً، وما في «بعد ذلك» يُعاد منه */}
                        <label className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center" title={moved ? "أعِده إلى مرحلته" : "أجّله إلى المرحلة التالية"}>
                          <input
                            type="checkbox"
                            checked={moved}
                            onChange={() => toggle(l.id)}
                            aria-label={moved ? `أعِد ${l.label} إلى مرحلته` : `أجّل ${l.label} إلى المرحلة التالية`}
                            className="h-4 w-4 accent-[var(--accent)]"
                          />
                        </label>
                        <Link href={l.href} className="flex min-w-0 flex-1 items-center gap-3 py-2.5 transition-colors hover:text-accent">
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-sunken text-ink-soft">
                            {l.kind === "SUPPLIER" ? <Store className="h-3.5 w-3.5" strokeWidth={2} aria-hidden /> : <Repeat className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[13px]">
                            {l.label}
                            {l.sub && <span className="ms-2 text-[11px] text-muted">{l.sub}</span>}
                            {moved && <span className="ms-2 text-[11px] font-bold text-info">مؤجَّلٌ من «{origin.get(l.id) ?? ""}»</span>}
                          </span>
                          <span className="nums-col shrink-0 text-[13px] font-bold"><Money minor={l.amountMinor} /></span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </article>
          </li>
        ))}
      </ol>
      {!trying && view.buckets.length > 0 && (
        <p className="mt-3 text-xs text-muted">
          «ماذا لو أجّلتُ هذا؟» — علّم مربّعَ أيّ سطرٍ لترى ما يبقى بعد كلّ مرحلة. تجربةٌ في هذه الصفحة لا تُحفَظ ولا تغيّر قيداً.
        </p>
      )}
    </>
  );
}

/**
 * خطُّ الرصيد المتوقَّع — مدرَّجٌ من آخر رصيدٍ معروف إلى ما يبقى بعد كلّ مرحلة.
 *
 * الزمنُ من اليمين إلى اليسار كما تُقرأ الصفحة. وما تحت الصفر يُلوَّن ويُكتب
 * بمبلغه — لا يُترَك للعين أن تقدّره. والواردُ غير مرسوم: الخطُّ حدٌّ أدنى، ويُقال.
 */
function BalanceSteps({ balanceMinor, buckets }: { balanceMinor: number; buckets: readonly OutlookBucket[] }) {
  const steps = [
    { id: "now", label: "الآن", minor: balanceMinor },
    ...buckets.flatMap((b) => (b.afterMinor === null ? [] : [{ id: b.id, label: b.id === LATER_BUCKET ? "بعد ذلك" : b.title, minor: b.afterMinor }])),
  ];
  if (steps.length < 2) return null;
  const top = Math.max(0, ...steps.map((s) => s.minor));
  const bottom = Math.min(0, ...steps.map((s) => s.minor));
  const span = top - bottom || 1;
  const W = 100;
  const H = 40;
  const y = (minor: number) => 2 + ((top - minor) / span) * (H - 4);
  const col = W / steps.length;
  /* اليمينُ أوّلاً: العمودُ `i` يبدأ عند `W - i*col` ويمتدّ يساراً */
  let d = "";
  steps.forEach((s, i) => {
    const x1 = W - i * col;
    const x2 = W - (i + 1) * col;
    d += `${i === 0 ? "M" : "L"}${x1.toFixed(2)},${y(s.minor).toFixed(2)} L${x2.toFixed(2)},${y(s.minor).toFixed(2)} `;
  });
  const zero = y(0);
  const lowest = steps.reduce((a, b) => (b.minor < a.minor ? b : a));

  return (
    <figure className="mb-6 rounded-xl border border-line bg-raised p-4 shadow-raised sm:p-5">
      <figcaption className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[13px] font-bold">الرصيدُ بعد كلّ مرحلة</span>
        <span className="text-[11px] text-muted">حدٌّ أدنى — الواردُ غير مرسوم</span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-28 w-full"
        role="img"
        aria-label={`خطُّ الرصيد المتوقَّع: يبدأ بآخر رصيدٍ معروف وأدناه عند «${lowest.label}»${lowest.minor < 0 ? " تحت الصفر" : ""}`}
      >
        {bottom < 0 && <rect x="0" y={zero} width={W} height={H - zero} className="fill-danger-bg" />}
        <line x1="0" x2={W} y1={zero} y2={zero} className="stroke-line-input" strokeWidth="1" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
        <path d={d} fill="none" className="stroke-accent" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {/* القيمُ مكتوبةٌ تحت أعمدتها — الرسمُ لا يُقرأ وحده */}
      <ol className="mt-2 grid gap-1" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((s) => (
          <li key={s.id} className="min-w-0 text-center">
            <span className="block truncate text-[10px] text-muted">{s.label}</span>
            <span className={`block truncate text-[11px] font-bold ${s.minor < 0 ? "text-danger" : ""}`}><Money minor={s.minor} /></span>
          </li>
        ))}
      </ol>
    </figure>
  );
}
