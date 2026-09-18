"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { INVOICE, QUOTATION, countNoun, FILE } from "@/lib/arabic";

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

interface ScannedFile {
  fileId: string;
  name: string;
  month: string;
  folder: string;
  understood: boolean;
}

interface Result {
  applied: boolean;
  /** ما سُجّل للتوّ واسمُه خارج الصيغة — يُقترَح هنا لا في شاشةٍ أخرى. */
  renameSuggestions?: RenameSuggestion[];
  quotations?: string[];
  summary: Summary;
  files?: ScannedFile[];
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
  /** معرّفاتُ ما لا يُفهم اسمُه — تُقرأ بها بلا إعادة مشي. */
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [renamed, setRenamed] = useState<{ ok: boolean; text: string } | null>(null);
  /** ما اختاره صاحب العمل للتسمية — فارغٌ حتى يختار. */
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  /** يُطبّق التسمية على ما اقتُرح — يستدعيها التسجيل والزرّ معاً. */
  const applyRenames = useCallback(async (fileIds: string[]) => {
    setRenaming(true);
    setRenamed(null);
    try {
      const res = await fetch("/api/drive-rename", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apply: true, fileIds }),
      });
      /* يُقرأ نصّاً قبل ادّعاء أنّه JSON — صفحةُ خطأٍ ليست JSON */
      const text = await res.text();
      let json: { message?: string; error?: string } | null = null;
      try { json = JSON.parse(text) as { message?: string; error?: string }; }
      catch { /* ليس JSON */ }
      setRenamed(
        !json ? { ok: false, text: `تعذّرت التسمية — ردّ الخادم بالرمز ${res.status}` }
        : res.ok ? { ok: true, text: json.message ?? "تمّت التسمية" }
        : { ok: false, text: json.error ?? "تعذّرت التسمية" },
      );
      if (res.ok) setChosen(new Set());
    } catch {
      setRenamed({ ok: false, text: "تعذّر الاتصال بالخادم — لم يصل الطلب. تحقّق من الشبكة ثمّ أعد المحاولة." });
    } finally {
      setRenaming(false);
    }
  }, []);

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
          أنّ الأشهر تُقرأ على دفعات.
        */
        let guard = 0;
        const suggestions = [...(json.renameSuggestions ?? [])];

        while (guard < 12 && json.summary?.truncated
          && (json.summary.pendingMonths?.length ?? 0) > 0) {
          guard++;
          const next = await post({
            apply, readContent: apply, onlyMonths: json.summary.pendingMonths,
          });
          suggestions.push(...(next.renameSuggestions ?? []));
          json = {
            ...next,
            summary: {
              ...next.summary,
              newFiles: json.summary.newFiles + next.summary.newFiles,
              understoodByName: json.summary.understoodByName + next.summary.understoodByName,
              needContentReading: json.summary.needContentReading + next.summary.needContentReading,
            },
          };
        }

        /*
          ── ثمّ تُقرأ الملفّات بمعرّفاتها، بلا إعادة المشي ──

          وهذا ما كان يُهدر الوقت: كلّ دفعةِ قراءةٍ تمشي من جديد على
          السنوات والأشهر ومجلّدات المورّدين — عشرون ثانية قبل أن
          يُقرأ حرف، ثمّ تُقتَل الدفعة. فصار المشي مرّةً في الفحص،
          والقراءة بالمعرّفات بعده.
        */
        if (apply) {
          const queue = pendingIds.slice();
          let rounds = 0;
          while (queue.length > 0 && rounds < 40) {
            rounds++;
            const chunk = queue.splice(0, 2);
            const next = await post({ apply: true, readContent: true, fileIds: chunk });
            suggestions.push(...(next.renameSuggestions ?? []));
            json = {
              ...json,
              summary: {
                ...json.summary,
                created: (json.summary.created ?? 0) + (next.summary.created ?? 0),
                contentRead: (json.summary.contentRead ?? 0) + (next.summary.contentRead ?? 0),
                remainingUnnamed: queue.length,
              },
            };
            setResult({ ...json, renameSuggestions: suggestions });
          }
          setPendingIds([]);
        } else {
          setPendingIds(
            (json.files ?? []).filter((f) => !f.understood).map((f) => f.fileId),
          );
        }

        json.renameSuggestions = suggestions;

        setResult(json);

        /*
          ── التسمية تُقترَح هنا، ولا تقع إلّا باختيار ──

          كانت تقع مع التسجيل على كلّ المقترَح قبل أن يراه أحد. والقيد
          الأوّل صريح: «لا شيء بلا اختيار الإنسان ملفّاً ملفّاً». فالسؤال
          يبقى في موضعه — حيث يُعرَف الملفّ للتوّ — والقائمة تبدأ فارغة،
          ويختار صاحب العمل ما يُسمّى، ويُكتب كلُّ اسمٍ بالاسمين في السجلّ.
        */
        setChosen(new Set());

        if (apply) router.refresh();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [full, router, pendingIds],
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
          {busy === "scanning" ? "يفحص الدرايف…" : "يسجّل الجديد ويقرؤه…"}
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
              ✓ سُجّل {s.created ?? 0} مستنداً، منها {countNoun(s.invoicesCreated ?? 0, INVOICE)}
              {s.contentRead ? ` · قُرئ محتوى ${s.contentRead}` : ""}
              {s.remainingUnnamed ? ` · بقي ${countNoun(s.remainingUnnamed, FILE)} يحتاج قراءة` : ""}
            </p>
          )}

          {/*
            ── تسميةُ ما سُجّل للتوّ ──

            الملفّ الذي رفعه المورّد باسمه يُكتشَف هنا، ويُقرأ محتواه
            هنا، فيُعرَف مورّدُه وتاريخُه وإجماليُّه هنا. فالسؤال يقع في
            هذه اللحظة — لا في شاشةٍ أخرى ينظر فيها الفحصُ إلى المسجَّل
            فيقول «لا شيء» لأنّ الجديد لم يكن قد سُجّل بعد.
          */}
          {result?.quotations && result.quotations.length > 0 && (
            <div className="mt-3 rounded-xl border border-warn/40 bg-warn-bg px-3 py-2.5">
              <p className="text-[11px] font-bold text-warn">
                {countNoun(result.quotations.length, QUOTATION)} — لم يُسجَّل
              </p>
              <p className="mt-1 text-[11px] text-muted">
                عرضُ السعر ليس واقعةً ماليّة: لا مالَ خرج ولا التزامَ نشأ. يبقى في
                الدرايف كما هو، فإن صار فاتورةً سُجّلت الفاتورة.
              </p>
              <ul className="mt-1.5 space-y-0.5">
                {result.quotations.slice(0, 6).map((q) => (
                  <li key={q} className="truncate text-[11px] text-muted" dir="ltr">{q}</li>
                ))}
              </ul>
            </div>
          )}

          {result?.renameSuggestions && result.renameSuggestions.length > 0 && (
            <fieldset className="mt-3 rounded-xl border border-line bg-sunken px-3 py-2.5">
              <legend className="px-1 text-[11px] font-bold text-warn">
                {countNoun(result.renameSuggestions.length, FILE)} اسمُه لا يُقرأ — اختر ما يُسمّى
              </legend>
              <p className="text-[11px] leading-relaxed text-muted">
                لا يُسمّى شيءٌ إلّا ما تختاره، ويُكتب الاسمان في سجلّ التدقيق. ولا حذف ولا نقل.
              </p>
              <ul className="mt-1.5 space-y-1">
                {result.renameSuggestions.map((r) => (
                  <li key={r.fileId}>
                    <label className="flex min-h-11 cursor-pointer items-start gap-2 leading-relaxed">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={chosen.has(r.fileId)}
                        onChange={() =>
                          setChosen((prev) => {
                            const next = new Set(prev);
                            if (next.has(r.fileId)) next.delete(r.fileId); else next.add(r.fileId);
                            return next;
                          })
                        }
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-[11px] text-muted line-through" dir="ltr">
                          {r.current}
                        </span>
                        <span className="block truncate text-[11px] font-bold" dir="ltr">
                          {r.proposed}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={renaming || chosen.size === 0}
                  onClick={() => applyRenames([...chosen])}
                  className="min-h-11 rounded-lg border border-line px-3 text-[11px] font-medium hover:border-ink-soft disabled:opacity-50"
                >
                  {renaming ? "يسمّي…" : `سمِّ المختار (${chosen.size})`}
                </button>
                {renamed && (
                  <span className={`text-[11px] ${renamed.ok ? "text-ok" : "text-danger"}`} role="status">
                    {renamed.text}
                  </span>
                )}
              </div>
            </fieldset>
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
                  <span className={`shrink-0 text-[11px] ${f.understood ? "text-muted" : "text-warn"}`}>
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
