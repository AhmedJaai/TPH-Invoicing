"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

interface Summary {
  scope: string;
  knownBefore: number;
  newFiles: number;
  understoodByName: number;
  needContentReading: number;
  created?: number;
  invoicesCreated?: number;
  contentRead?: number;
  remainingUnnamed?: number;
  /** أشهرٌ أوقفتها المهلة — يستأنفها الطلب التالي. */
  pendingMonths?: string[];
  truncated?: boolean;
}

interface RenameSuggestion {
  fileId: string;
  current: string;
  proposed: string;
}

interface Result {
  applied: boolean;
  /** ما سُجّل للتوّ واسمُه خارج الصيغة — يُقترَح هنا لا في شاشةٍ أخرى. */
  renameSuggestions?: RenameSuggestion[];
  summary: Summary;
  files?: { name: string; month: string; folder: string; understood: boolean }[];
  notes?: string[];
  readFailures?: string[];
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  const cls = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "";
  return (
    <div className="rounded-lg border border-line bg-raised px-3 py-2">
      <p className="text-[11px] text-muted">{label}</p>
      <p className={`nums mt-0.5 text-base font-bold ${cls}`}>{value}</p>
    </div>
  );
}

/**
 * المزامنة مع الدرايف.
 *
 * الأرشيف يُقرأ بمحتواه مرّة واحدة. وهذا الزرّ للسؤال المتكرّر بعدها:
 * هل أضاف أحدٌ ملفاً بيده في الدرايف؟ فيقارن ويضيف الفرق وحده.
 */
export function DriveSync() {
  const router = useRouter();
  const [busy, setBusy] = useState<"scanning" | "applying" | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renamed, setRenamed] = useState<string | null>(null);

  const call = useCallback(
    async (apply: boolean) => {
      setBusy(apply ? "applying" : "scanning");
      setError(null);

      /*
        الشاشة تقرأ النصّ قبل أن تدّعي أنّه JSON.

        كان `res.json()` يُستدعى بلا شرط، فإن ردّ المزوّد صفحة خطأ —
        وهو ما يقع عند تجاوز المهلة — انفجرت برسالة
        «Unexpected token 'A'». وهي رسالةٌ عن المحلّل لا عن العطب،
        فيقف صاحب العمل أمام نصٍّ لا يدلّه على شيء.
      */
      const post = async (body: unknown) => {
        const res = await fetch("/api/drive-sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const text = await res.text();
        let json: (Result & { error?: string }) | null = null;
        try { json = JSON.parse(text) as Result & { error?: string }; } catch { /* ليس JSON */ }

        if (!json) {
          throw new Error(
            res.status === 504 || /timeout|timed out/i.test(text)
              ? "استغرقت القراءة أكثر من المسموح. جرّب بلا «الأرشيف كله»، أو أعد المحاولة — يُستأنف من حيث وقف."
              : `تعذّرت المزامنة (${res.status}). ${text.slice(0, 120)}`,
          );
        }
        if (!res.ok) throw new Error(json.error ?? "تعذّرت المزامنة");
        return json;
      };

      try {
        let json = await post({ full, apply, readContent: apply, months: 3 });

        /*
          ما أوقفته المهلة يُستأنَف — والمستخدم لا يُطلَب منه أن يفهم
          أنّ الأشهر تُقرأ على دفعات، ولا أنّ المحتوى يُقرأ اثنين
          اثنين.
        */
        let guard = 0;
        const suggestions = [...(json.renameSuggestions ?? [])];

        while (guard < 12) {
          const moreMonths = json.summary?.truncated
            && (json.summary.pendingMonths?.length ?? 0) > 0;
          const moreContent = apply && (json.summary?.remainingUnnamed ?? 0) > 0;
          if (!moreMonths && !moreContent) break;
          guard++;

          const next = await post(
            moreMonths
              ? { apply, readContent: apply, onlyMonths: json.summary.pendingMonths }
              : { full, apply, readContent: apply, months: 3 },
          );
          suggestions.push(...(next.renameSuggestions ?? []));
          json = {
            ...next,
            renameSuggestions: suggestions,
            summary: {
              ...next.summary,
              newFiles: json.summary.newFiles,
              understoodByName: json.summary.understoodByName,
              needContentReading: json.summary.needContentReading,
              created: (json.summary.created ?? 0) + (next.summary.created ?? 0),
              contentRead: (json.summary.contentRead ?? 0) + (next.summary.contentRead ?? 0),
            },
          };
        }
        json.renameSuggestions = suggestions;

        setResult(json);
        if (apply) router.refresh();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [full, router],
  );

  if (!open) {
    return (
      <button
        onClick={() => { setOpen(true); void call(false); }}
        className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-soft hover:border-ink-soft"
      >
        افحص الدرايف عن ملفات جديدة
      </button>
    );
  }

  const s = result?.summary;

  return (
    <section className="rounded-2xl border border-line bg-raised shadow-raised p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold">مزامنة الدرايف</h2>
        <button onClick={() => setOpen(false)} className="text-[11px] text-muted hover:text-ink">
          إغلاق
        </button>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-ink-soft">
        يقارن ملفات الدرايف بما هو مسجّل عندنا، ويضيف ما لا سجلّ له وحده — كملف رفعتَه
        بيدك. لا يعيد قراءة ما قُرئ، ولا يمسّ الدرايف إلا قراءةً.
      </p>

      <label className="mt-3 flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={full}
          onChange={(e) => setFull(e.target.checked)}
          className="accent-black dark:accent-white"
        />
        افحص الأرشيف كله بدل آخر ثلاثة أشهر (أبطأ)
      </label>

      {error && <p className="mt-3 rounded-lg bg-danger-bg px-3 py-2 text-xs text-danger">{error}</p>}

      {busy && (
        <p className="mt-3 text-xs text-muted">
          {busy === "scanning" ? "يفحص الدرايف…" : "يسجّل الجديد ويقرأ ما لا يُفهم اسمه…"}
        </p>
      )}

      {s && !busy && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="النطاق" value={s.scope} />
            <Stat label="ملفات جديدة" value={String(s.newFiles)} tone={s.newFiles ? "warn" : "ok"} />
            <Stat label="فُهم اسمها" value={String(s.understoodByName)} />
            <Stat
              label="تحتاج قراءة محتوى"
              value={String(s.needContentReading)}
              tone={s.needContentReading ? "warn" : undefined}
            />
          </div>

          {result?.applied && (
            <p className="mt-3 rounded-lg bg-ok-bg px-3 py-2 text-xs font-bold text-ok">
              ✓ سُجّل {s.created ?? 0} مستنداً، منها {s.invoicesCreated ?? 0} فاتورة
              {s.contentRead ? ` · قُرئ محتوى ${s.contentRead}` : ""}
              {s.remainingUnnamed ? ` · بقي ${s.remainingUnnamed} ملفاً يحتاج قراءة` : ""}
            </p>
          )}

          {/*
            ── تسميةُ ما سُجّل للتوّ ──

            الملفّ الذي رفعه المورّد باسمه يُكتشَف هنا، ويُقرأ محتواه
            هنا، فيُعرَف مورّدُه وتاريخُه وإجماليُّه هنا. فالسؤال يقع في
            هذه اللحظة — لا في شاشةٍ أخرى ينظر فيها الفحصُ إلى المسجَّل
            فيقول «لا شيء» لأنّ الجديد لم يكن قد سُجّل بعد.
          */}
          {result?.renameSuggestions && result.renameSuggestions.length > 0 && (
            <div className="mt-3 rounded-xl border border-line bg-sunken px-3 py-2.5">
              <p className="text-[11px] font-bold text-warn">
                {result.renameSuggestions.length} ملفّاً سُجّل واسمُه خارج الصيغة
              </p>
              <ul className="mt-1.5 space-y-1">
                {result.renameSuggestions.slice(0, 8).map((r) => (
                  <li key={r.fileId} className="leading-relaxed">
                    <span className="block truncate text-[10px] text-muted line-through" dir="ltr">
                      {r.current}
                    </span>
                    <span className="block truncate text-[10px] font-bold" dir="ltr">
                      {r.proposed}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  disabled={renaming}
                  onClick={async () => {
                    setRenaming(true);
                    setRenamed(null);
                    try {
                      const res = await fetch("/api/drive-rename", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({
                          apply: true,
                          fileIds: result.renameSuggestions!.map((r) => r.fileId),
                        }),
                      });
                      const text = await res.text();
                      let json: { message?: string; error?: string } | null = null;
                      try { json = JSON.parse(text) as { message?: string; error?: string }; }
                      catch { /* ليس JSON */ }
                      setRenamed(
                        !json ? `تعذّرت التسمية (${res.status})`
                        : res.ok ? (json.message ?? "تمّت") : (json.error ?? "تعذّرت التسمية"),
                      );
                      if (res.ok) router.refresh();
                    } catch (e) {
                      setRenamed((e as Error).message);
                    } finally {
                      setRenaming(false);
                    }
                  }}
                  className="rounded-lg border border-line px-2.5 py-1 text-[11px] font-medium hover:border-ink-soft"
                >
                  {renaming ? "يوحّد…" : "وحّد تسميتها في الدرايف"}
                </button>
                {renamed && <span className="text-[10px] text-muted">{renamed}</span>}
              </div>
            </div>
          )}

          {result?.notes && result.notes.length > 0 && (
            <div className="mt-3">
              <p className="text-[11px] font-bold text-warn">تحتاج نظرك</p>
              <ul className="mt-1 space-y-0.5">
                {result.notes.map((n, i) => (
                  <li key={i} className="text-[11px] leading-relaxed text-ink-soft">{n}</li>
                ))}
              </ul>
            </div>
          )}

          {result?.readFailures && result.readFailures.length > 0 && (
            <div className="mt-3">
              <p className="text-[11px] font-bold text-danger">لم تُقرأ</p>
              <ul className="mt-1 space-y-0.5">
                {result.readFailures.map((n, i) => (
                  <li key={i} className="text-[11px] leading-relaxed text-ink-soft">{n}</li>
                ))}
              </ul>
            </div>
          )}

          {!result?.applied && result?.files && result.files.length > 0 && (
            <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
              {result.files.slice(0, 10).map((f, i) => (
                <li key={i} className="flex items-center justify-between gap-3 px-3 py-1.5">
                  <span className="min-w-0 truncate font-mono text-[11px]" dir="ltr">{f.name}</span>
                  <span className={`shrink-0 text-[10px] ${f.understood ? "text-muted" : "text-warn"}`}>
                    {f.understood ? f.month : "يحتاج قراءة"}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex gap-2">
            <button
              onClick={() => void call(false)}
              className="rounded-lg border border-line px-3 py-2 text-xs font-medium hover:border-ink-soft"
            >
              أعد الفحص
            </button>
            {s.newFiles > 0 && (
              <button
                onClick={() => void call(true)}
                className="rounded-lg bg-inverse-surface px-4 py-2 text-xs font-bold text-inverse-ink"
              >
                {result?.applied ? "أكمل الباقي" : "سجّل الجديد"}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
