"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, FolderSync, X } from "lucide-react";
import { INVOICE, QUOTATION, countNoun, FILE } from "@/lib/arabic";
import { buttonClass } from "./ui-tokens";
import { toast } from "./ui-client";
import { GAP_TEXT, type AutoArchiveGap } from "@/lib/extraction/auto-archive";

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
  autoArchived?: number;
  needsReview?: number;
  renamed?: number;
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
  /** ما سُمّي آلياً بعد أرشفته — بالاسمين. */
  renamed?: { from: string; to: string }[];
  /** لماذا لم يدخل ما لم يدخل — مجموعاً بالسبب. */
  reviewReasons?: { gap: AutoArchiveGap; count: number }[];
  /** استدراكُ ما تراكم — في الطلب الأوّل من المزامنة. */
  backlog?: { recorded: number; approved: number; notes: string[] };
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  const cls = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "";
  return (
    <div className="rounded-lg bg-sunken px-3 py-2">
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
        /* ما دخل وحده، وما سُمّي، وأسبابُ ما ينتظر — تُجمَع عبر الدفعات */
        const tally = { auto: 0, review: 0 };
        const renamedAll: { from: string; to: string }[] = [];
        const reasons = new Map<AutoArchiveGap, number>();
        const absorb = (r: Result) => {
          tally.auto += r.summary.autoArchived ?? 0;
          tally.review += r.summary.needsReview ?? 0;
          renamedAll.push(...(r.renamed ?? []));
          for (const g of r.reviewReasons ?? []) reasons.set(g.gap, (reasons.get(g.gap) ?? 0) + g.count);
        };
        absorb(json);
        const backlog = json.backlog;

        while (guard < 12 && json.summary?.truncated
          && (json.summary.pendingMonths?.length ?? 0) > 0) {
          guard++;
          const next = await post({
            apply, readContent: apply, onlyMonths: json.summary.pendingMonths,
          });
          suggestions.push(...(next.renameSuggestions ?? []));
          absorb(next);
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
            absorb(next);
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
        json.renamed = renamedAll;
        json.backlog = backlog;
        json.reviewReasons = [...reasons.entries()].map(([gap, count]) => ({ gap, count }));
        json.summary = { ...json.summary, autoArchived: tally.auto, needsReview: tally.review };

        setResult(json);

        /*
          ── التسمية تُقترَح هنا، ولا تقع إلّا باختيار ──

          كانت تقع مع التسجيل على كلّ المقترَح قبل أن يراه أحد. والقيد
          الأوّل صريح: «لا شيء بلا اختيار الإنسان ملفّاً ملفّاً». فالسؤال
          يبقى في موضعه — حيث يُعرَف الملفّ للتوّ — والقائمة تبدأ فارغة،
          ويختار صاحب العمل ما يُسمّى، ويُكتب كلُّ اسمٍ بالاسمين في السجلّ.
        */
        setChosen(new Set());

        if (apply) {
          toast({
            tone: "ok",
            title: "سُجّل الجديد من الدرايف",
            body: `دخل وحده ${countNoun(tally.auto, FILE)}${tally.review > 0 ? ` · ينتظر مراجعتك ${countNoun(tally.review, FILE)}` : ""}`,
          });
          router.refresh();
        }
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
      <div className="flex flex-col rounded-xl border border-line bg-raised p-4 shadow-raised">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
            <FolderSync className="h-4 w-4" strokeWidth={2} aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold">ملفّاتٌ جديدة في الدرايف</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">
              يقارن الدرايف بالمسجَّل ويعرض ما لا سجلّ له — ولا يُسجَّل شيءٌ حتى تضغط «سجّل الجديد».
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => { setOpen(true); void call(false); }}
          className={`mt-4 self-start ${buttonClass("secondary", "sm")}`}
        >
          افحص الآن
        </button>
      </div>
    );
  }

  const s = result?.summary;

  return (
    <section className="rounded-xl border border-accent-line bg-raised p-4 shadow-lifted lg:col-span-2 sm:p-5" aria-label="مزامنة الدرايف">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
            <FolderSync className="h-4 w-4" strokeWidth={2} aria-hidden />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-bold">مزامنة الدرايف</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">
              يقارن ملفات الدرايف بما هو مسجّل عندنا، ويضيف ما لا سجلّ له — كملفٍّ وضعتَه بيدك.
              لا يعيد قراءة ما قُرئ، ولا حذف ولا نقل.
            </p>
          </div>
        </div>
        <button type="button" onClick={() => setOpen(false)} aria-label="أغلق المزامنة" className="-me-1 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink">
          <X className="h-4 w-4" strokeWidth={2} aria-hidden />
        </button>
      </div>

      <label className="mt-3 flex min-h-11 items-center gap-2 text-xs sm:min-h-0">
        <input
          type="checkbox"
          checked={full}
          onChange={(e) => setFull(e.target.checked)}
          className="h-4 w-4 accent-[var(--accent)]"
        />
        افحص الأرشيف كله بدل آخر ثلاثة أشهر (أبطأ)
      </label>

      {error && (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-bg px-3 py-2 text-xs text-danger">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
          {error}
        </p>
      )}

      {busy && (
        <div className="mt-3" aria-live="polite">
          <p className="text-xs text-ink-soft">{busy === "scanning" ? "يفحص الدرايف…" : "يسجّل الجديد ويقرؤه…"}</p>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sunken">
            <div className="upload-bar h-full w-1/3 rounded-full bg-accent" />
          </div>
        </div>
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
            <p className="mt-3 flex items-start gap-2 rounded-lg border border-ok/25 bg-ok-bg px-3 py-2 text-xs font-bold text-ok">
              <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
              سُجّل {s.created ?? 0} مستنداً، منها {countNoun(s.invoicesCreated ?? 0, INVOICE)}
              {s.contentRead ? ` · قُرئ محتوى ${s.contentRead}` : ""}
              {s.remainingUnnamed ? ` · بقي ${countNoun(s.remainingUnnamed, FILE)} يحتاج قراءة` : ""}
            </p>
          )}

          {/*
            ── ما دخل وحده، وما ينتظرك ولماذا ──

            «كلّها فيها المعلومات، لكنّه ما يستخرجها أو ما يعتمدها» — فيُقال
            بعد كلّ مزامنة كم دخل وحده، وكم ينتظر، وأيُّ شرطٍ أسقط ما ينتظر.
          */}
          {result?.backlog && (result.backlog.recorded > 0 || result.backlog.approved > 0) && (
            <p className="mt-2 rounded-lg bg-ok-bg px-3 py-2 text-[11px] font-bold text-ok">
              استُدرك ما تراكم:
              {result.backlog.recorded > 0 && ` قُيِّدت ${countNoun(result.backlog.recorded, INVOICE)} من قراءتها المحفوظة`}
              {result.backlog.recorded > 0 && result.backlog.approved > 0 && " ·"}
              {result.backlog.approved > 0 && ` اعتُمد ${countNoun(result.backlog.approved, FILE)} تجتمع فيه الشروط`}
            </p>
          )}
          {result?.applied && ((s.autoArchived ?? 0) > 0 || (s.needsReview ?? 0) > 0) && (
            <div className="mt-2 rounded-lg border border-line bg-sunken px-3 py-2 text-[11px] leading-relaxed">
              <p>
                <strong className="text-ok">دخل وحده {countNoun(s.autoArchived ?? 0, FILE)}</strong>
                {(s.needsReview ?? 0) > 0 && (
                  <> · <strong className="text-warn">ينتظر مراجعتك {countNoun(s.needsReview ?? 0, FILE)}</strong>
                    {" "}— في <Link href="/documents?status=NEEDS_REVIEW" className="font-bold text-accent underline underline-offset-4">المستندات</Link></>
                )}
              </p>
              {result.reviewReasons && result.reviewReasons.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-muted">
                  {result.reviewReasons
                    .slice()
                    .sort((a, b) => b.count - a.count)
                    .map((r) => (
                      <li key={r.gap}><bdi className="nums">{r.count}</bdi> · {GAP_TEXT[r.gap]}</li>
                    ))}
                </ul>
              )}
            </div>
          )}

          {result?.renamed && result.renamed.length > 0 && (
            <details className="mt-2 rounded-lg border border-line bg-raised px-3 py-2 text-[11px]">
              <summary className="cursor-pointer font-bold text-ok">
                أُعيدت تسمية {countNoun(result.renamed.length, FILE)} في الدرايف آلياً
              </summary>
              <ul className="mt-1.5 space-y-0.5 text-muted">
                {result.renamed.map((r) => (
                  <li key={r.to} className="truncate" dir="ltr">{r.from} → {r.to}</li>
                ))}
              </ul>
            </details>
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
                  aria-busy={renaming}
                  type="button"
                  disabled={renaming || chosen.size === 0}
                  onClick={() => applyRenames([...chosen])}
                  className={buttonClass("secondary", "sm")}
                >
                  {`سمِّ المختار (${chosen.size})`}
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

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void call(false)}
              className={buttonClass("secondary", "sm")}
            >
              أعد الفحص
            </button>
            {s.newFiles > 0 && (
              <button
                type="button"
                onClick={() => void call(true)}
                className={buttonClass("primary", "sm")}
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
