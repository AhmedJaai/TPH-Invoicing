"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "./ui";

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
}

interface Preview {
  summary: { archived: number; onStandard: number; toRename: number; cannot: number };
  proposals: Proposal[];
  cannot: { current: string; reason: string }[];
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
      setChosen(new Set(json.proposals.map((p) => p.fileId)));
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
      <button
        onClick={() => { setOpen(true); void scan(); }}
        className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-soft hover:border-ink-soft"
      >
        افحص تسمية الأرشيف
      </button>
    );
  }

  const toggle = (id: string) =>
    setChosen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-bold">توحيد تسمية الأرشيف</h3>
        <button onClick={() => setOpen(false)} className="text-[11px] text-muted hover:text-ink">
          إغلاق
        </button>
      </div>

      <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
        يُقارَن اسمُ كل ملفٍّ مؤرشَف بالاسم القياسيّ المشتقّ من بياناته المقيَّدة.
        ولا يُعاد تسميةُ شيء إلّا ما تختاره — ولا حذف ولا نقل.
      </p>

      {busy && <p className="mt-3 text-xs text-muted">يفحص…</p>}

      {data && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["مؤرشَفة", data.summary.archived, ""],
              ["على الصيغة", data.summary.onStandard, "text-ok"],
              ["تحتاج تسمية", data.summary.toRename, data.summary.toRename ? "text-warn" : ""],
              ["لا يُبنى لها اسم", data.summary.cannot, ""],
            ].map(([label, value, cls]) => (
              <div key={String(label)} className="rounded-lg border border-line bg-raised px-3 py-2">
                <p className="text-[11px] text-muted">{label}</p>
                <p className={`nums mt-0.5 text-base font-bold ${cls}`}>{String(value)}</p>
              </div>
            ))}
          </div>

          {data.proposals.length > 0 && (
            <ul className="mt-3 max-h-80 space-y-1.5 overflow-y-auto">
              {data.proposals.map((p) => (
                <li key={p.fileId} className="rounded-xl border border-line px-3 py-2">
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={chosen.has(p.fileId)}
                      onChange={() => toggle(p.fileId)}
                      className="mt-0.5"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-[11px] text-muted line-through" dir="ltr">
                        {p.current}
                      </span>
                      <span className="block truncate text-[11px] font-bold" dir="ltr">
                        {p.proposed}
                      </span>
                      <span className="block text-[10px] text-muted">{p.reason}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          {data.cannot.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[11px] text-muted">
                لا يُبنى لها اسم ({data.cannot.length}) — تُعرَض ولا تُمَسّ
              </summary>
              <ul className="mt-1.5 space-y-1">
                {data.cannot.map((c, i) => (
                  <li key={i} className="text-[10px] leading-relaxed text-muted">
                    <span dir="ltr">{c.current}</span> — {c.reason}
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
            <button
              type="button"
              disabled={busy}
              onClick={scan}
              className={buttonClass("secondary", "sm")}
            >
              أعد الفحص
            </button>
            {message && (
              <span className={`text-[11px] ${failed ? "text-danger" : "text-ok"}`}>{message}</span>
            )}
          </div>
        </>
      )}

      {!data && message && (
        <p className={`mt-3 text-[11px] ${failed ? "text-danger" : "text-muted"}`}>{message}</p>
      )}
    </div>
  );
}
