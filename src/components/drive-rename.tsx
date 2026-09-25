"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, PenLine, X } from "lucide-react";
import { buttonClass } from "./ui-tokens";
import { toast } from "./ui-client";

/**
 * توحيد تسمية الأرشيف — بمعاينةٍ واختيار.
 *
 * الأرشيف كلّه على صيغةٍ واحدة: تاريخٌ، فمورّد، فنوعٌ، فإجماليّ. وما
 * يُرفَع باليد يخرج عنها — «فاتورة ٣.pdf» — فيصير الأرشيف نصفَ منظَّم.
 *
 * وهذه أوّلُ شاشةٍ في النظام **تكتب** في الدرايف، وأوّلُ قيدٍ في
 * المشروع يمنع ذلك بلا طلبٍ صريح. فالقيود ظاهرةٌ فيها لا مخفيّة:
 * الاسمان يُعرَضان قبل أيّ فعل، والاختيار ملفٌّ ملفّاً، وما لا يُبنى
 * له اسمٌ يُعرَض بسببه ولا يُقترَح له شيء.
 */
interface Proposal {
  fileId: string;
  current: string;
  proposed: string;
  reason: string;
  pending?: boolean;
}

interface Preview {
  summary: { archived: number; onStandard: number; toRename: number; cannot: number };
  proposals: Proposal[];
  cannot: { current: string; reason: string; fixHref: string | null }[];
}

export function DriveRename() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<Preview | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  /** يقرأ النصّ قبل أن يدّعي أنّه JSON — فصفحةُ الخطأ لا تنفجر رمزاً. */
  const post = useCallback(async (body: unknown) => {
    const res = await fetch("/api/drive-rename", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: (Preview & { error?: string; message?: string }) | null = null;
    try { json = JSON.parse(text) as Preview & { error?: string; message?: string }; }
    catch { /* ليس JSON */ }
    if (!json) throw new Error(`تعذّر الفحص (${res.status}). ${text.slice(0, 120)}`);
    if (!res.ok) throw new Error(json.error ?? "تعذّر الفحص");
    return json;
  }, []);

  const scan = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    setMessage(null);
    try {
      const json = await post({});
      setData(json);
      /* لا شيء مختاراً سلفاً: «اختيارُ ملفٍّ ملفّاً» لا «إلغاءُ اختيارِ ملفٍّ ملفّاً» */
      setChosen(new Set());
    } catch (e) {
      setFailed(true);
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [post]);

  const apply = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    try {
      const json = await post({ apply: true, fileIds: [...chosen] });
      setMessage(json.message ?? "تمّت");
      toast({ tone: "ok", title: "أُعيدت التسمية في الدرايف", body: json.message ?? "كُتب الاسمان في سجلّ التدقيق." });
      router.refresh();
      await scan();
    } catch (e) {
      setFailed(true);
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [chosen, post, router, scan]);

  if (!open) {
    return (
      <div className="flex flex-col rounded-xl border border-line bg-raised p-4 shadow-raised">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-sunken text-ink-soft">
            <PenLine className="h-4 w-4" strokeWidth={2} aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold">أسماءٌ خارج الصيغة</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">
              تُسمّى وحدها في كلّ مزامنة. وهنا ما تريد تسميتَه الآن بيدك — بمعاينةٍ واختيارٍ ملفّاً ملفّاً.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => { setOpen(true); void scan(); }}
          className={`mt-4 self-start ${buttonClass("secondary", "sm")}`}
        >
          افحص التسمية
        </button>
      </div>
    );
  }

  const toggle = (id: string) =>
    setChosen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  return (
    <div className="rounded-xl border border-accent-line bg-raised p-4 shadow-lifted lg:col-span-2 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-sunken text-ink-soft">
            <PenLine className="h-4 w-4" strokeWidth={2} aria-hidden />
          </span>
          <h3 className="pt-2 text-sm font-bold">توحيد تسمية الأرشيف</h3>
        </div>
        <button type="button" onClick={() => setOpen(false)} aria-label="أغلق التسمية" className="-me-1 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink">
          <X className="h-4 w-4" strokeWidth={2} aria-hidden />
        </button>
      </div>

      <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
        يُقارَن اسمُ كل ملفٍّ مؤرشَف بالاسم القياسيّ المشتقّ من بياناته المقيَّدة.
        ولا يُعاد تسميةُ شيء إلّا ما تختاره — ولا حذف ولا نقل.
      </p>

      {busy && (
        <div className="mt-3" aria-live="polite">
          <p className="text-xs text-ink-soft">يفحص…</p>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sunken">
            <div className="upload-bar h-full w-1/3 rounded-full bg-accent" />
          </div>
        </div>
      )}

      {data && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["مؤرشَفة", data.summary.archived, ""],
              ["على الصيغة", data.summary.onStandard, "text-ok"],
              ["تحتاج تسمية", data.summary.toRename, data.summary.toRename ? "text-warn" : ""],
              ["ينقصها بيانات", data.summary.cannot, ""],
            ].map(([label, value, cls]) => (
              <div key={String(label)} className="rounded-lg bg-sunken px-3 py-2">
                <p className="text-[11px] text-muted">{label}</p>
                <p className={`nums mt-0.5 text-base font-bold ${cls}`}>{String(value)}</p>
              </div>
            ))}
          </div>

          {/*
            نطاق الفحص يُقال، لأنّ صفره ليس نفياً عامّاً.

            هذا الفحص ينظر إلى **المسجَّل** وحده. والملفّ الذي وجدته
            المزامنة للتوّ لم يُسجَّل بعد، فلا يدخله. فيرى صاحب العمل
            سبعة أسماء غلط في اللوحة التي فوق، ثمّ «٠ تحتاج تسمية»
            هنا — فيحسب أنّ إعادة التسمية معطّلة.

            والصفرُ صحيح، لكنّه صفرٌ في نطاقٍ لم يُذكَر. **والعدد الذي
            لا يُقال نطاقُه يُقرأ نفياً.**
          */}
          <p className="mt-3 text-xs leading-relaxed text-muted">
            <strong className="text-ink">التسميةُ تقع آلياً في كلّ مزامنة</strong> لكلّ مستندٍ معتمَد اسمُه خارج
            الصيغة (خمسةٌ وعشرون في كلّ مرّة). وهذه القائمة لما تريد تسميتَه الآن بيدك. وما ينتظر المراجعة
            يُسمّى حين يُعتمَد — اسمُه مبنيٌّ من قراءةٍ لم تُحسَم بعد. يفحص المسجَّل وحده ({data.summary.archived} مستنداً).
          </p>

          {data.proposals.length > 0 && (
            <ul className="mt-3 max-h-80 space-y-1.5 overflow-y-auto">
              {data.proposals.map((p) => (
                <li key={p.fileId} className="rounded-xl border border-line px-3 py-2">
                  <label className="flex min-h-11 cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      checked={chosen.has(p.fileId)}
                      onChange={() => toggle(p.fileId)}
                      className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-[11px] text-muted line-through" dir="ltr">
                        {p.current}
                      </span>
                      <span className="block truncate text-[11px] font-bold" dir="ltr">
                        {p.proposed}
                      </span>
                      <span className="block text-[11px] text-muted">
                        {p.reason}
                        {p.pending && <span className="text-warn"> · ينتظر المراجعة — يُسمّى حين يُعتمَد</span>}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          {data.cannot.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[11px] text-muted">
                ينقصها ما يُبنى به الاسم ({data.cannot.length}) — أكمِل الناقص ثمّ أعد الفحص
              </summary>
              {/*
                كانت قائمةً ميّتة: تقول «لا رقم فاتورة مقيَّد له» وتقف.
                والنقصُ ليس في التسمية بل في بيانات الفاتورة، وموضعُ
                إصلاحه شاشةٌ أخرى — فصار لكلّ سطرٍ بابُه.
              */}
              <ul className="mt-1.5 space-y-1">
                {data.cannot.map((c, i) => (
                  <li key={i} className="text-[11px] leading-relaxed text-muted">
                    <span dir="ltr">{c.current}</span> — {c.reason}
                    {c.fixHref && (
                      <>
                        {" "}
                        <a href={c.fixHref} className="font-bold text-ink underline underline-offset-4">
                          أكمِل الناقص ←
                        </a>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy || chosen.size === 0}
              onClick={apply}
              className={buttonClass("primary", "sm")}
            >
              {busy ? "يعيد التسمية…" : `أعد تسمية المختار (${chosen.size})`}
            </button>
            {data.proposals.some((p) => !p.pending) && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setChosen(new Set(data.proposals.filter((p) => !p.pending).map((p) => p.fileId)))}
                className={buttonClass("secondary", "sm")}
              >
                اختر كلَّ المعتمَد ({data.proposals.filter((p) => !p.pending).length})
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={scan}
              className={buttonClass("secondary", "sm")}
            >
              أعد الفحص
            </button>
            {message && (
              <span role={failed ? "alert" : "status"} className={`inline-flex items-center gap-1 text-[11px] font-bold ${failed ? "text-danger" : "text-ok"}`}>
                {failed ? <CircleAlert className="h-3.5 w-3.5" strokeWidth={2} aria-hidden /> : <CircleCheck className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />}
                {message}
              </span>
            )}
          </div>
        </>
      )}

      {!data && message && (
        <p role={failed ? "alert" : undefined} className={`mt-3 text-[11px] font-bold ${failed ? "text-danger" : "text-muted"}`}>{message}</p>
      )}
    </div>
  );
}
