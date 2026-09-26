"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, CloudOff, FolderSync, Loader2, TriangleAlert } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { DOCUMENT, FILE, countNoun } from "@/lib/arabic";
import type { DriveState } from "@/lib/drive-state";
import { buttonClass } from "./ui-tokens";
import { toast } from "./ui-client";

/**
 * «زامن الآن» — ما تفعله المزامنةُ الآليّة كلَّ ثلاث ساعات، بضغطةٍ واحدة:
 *
 *   ١. يفحص الدرايف (الأشهر الثلاثة الأخيرة) ويأخذ ما لا سجلّ له.
 *   ٢. يقرأ الجديد، ويؤرشف وحده ما اجتمعت فيه الشروطُ الأربعة، ويُسمّيه.
 *   ٣. يستدرك ما تراكم: يعتمد ما تجتمع فيه الشروط، ويسمّي المؤرشَفَ خارج الصيغة.
 *
 * ثمّ يقول ما فعل بأرقامه: كم جديداً، وكم دخل، وكم ينتظرك، وكم سُمّي. والخادمُ
 * يحكم في كلّ خطوةٍ كما يحكم في الآليّة — لا يُؤخَذ من المتصفّح إلّا الطلب.
 */

interface SyncSummary {
  newFiles?: number;
  created?: number;
  autoArchived?: number;
  needsReview?: number;
  remainingUnnamed?: number;
  pendingMonths?: string[];
  truncated?: boolean;
}

interface SyncReply {
  summary: SyncSummary;
  renamed?: { from: string; to: string }[];
  backlog?: { recorded: number; approved: number };
  readFailures?: string[];
}

interface BacklogReply {
  recorded?: number;
  approved?: number;
  renamed?: { from: string; to: string }[];
}

interface Outcome {
  newFiles: number;
  created: number;
  autoArchived: number;
  needsReview: number;
  remaining: number;
  approved: number;
  renamed: { from: string; to: string }[];
  failures: number;
}

type Phase = "scan" | "read" | "tidy";

const PHASE_LABEL: Record<Phase, string> = {
  scan: "يفحص الدرايف…",
  read: "يقرأ الجديد ويؤرشف ما تجتمع فيه الشروط…",
  tidy: "يستدرك ما تراكم ويسمّي ما خرج عن الصيغة…",
};

export function DriveSyncNow({
  state,
  headline,
  detail,
  facts,
  reconnect,
}: {
  state: DriveState;
  headline: string;
  detail: string;
  /** «آخرُ مزامنة» و«آخرُ ما وجدته جديداً» و«آخرُ تسمية» — مصوغةٌ في الخادم بتوقيت الرياض. */
  facts: readonly { label: string; value: string; hint?: string }[];
  reconnect?: () => Promise<void>;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<{ text: string; auth: boolean } | null>(null);

  const canRun = state !== "preview" && state !== "disconnected";
  const tone =
    state === "ok" ? { ring: "border-ok/30", icon: CircleCheck, ink: "text-ok", chip: "bg-ok-bg" }
    : state === "failing" || state === "disconnected" ? { ring: "border-danger/30", icon: TriangleAlert, ink: "text-danger", chip: "bg-danger-bg" }
    : state === "preview" ? { ring: "border-line", icon: CloudOff, ink: "text-info", chip: "bg-info-bg" }
    : { ring: "border-warn/30", icon: CircleAlert, ink: "text-warn", chip: "bg-warn-bg" };
  const Icon = tone.icon;

  async function run() {
    setError(null);
    setOutcome(null);
    const o: Outcome = { newFiles: 0, created: 0, autoArchived: 0, needsReview: 0, remaining: 0, approved: 0, renamed: [], failures: 0 };
    const absorb = (r: SyncReply, countNew: boolean) => {
      if (countNew) o.newFiles += r.summary.newFiles ?? 0;
      o.created += r.summary.created ?? 0;
      o.autoArchived += r.summary.autoArchived ?? 0;
      o.needsReview += r.summary.needsReview ?? 0;
      o.approved += (r.backlog?.approved ?? 0) + (r.backlog?.recorded ?? 0);
      o.renamed.push(...(r.renamed ?? []));
      o.failures += r.readFailures?.length ?? 0;
      o.remaining = r.summary.remainingUnnamed ?? 0;
    };
    const fail = (text: string, status: number) => {
      setError({ text, auth: status === 428 });
      setPhase(null);
    };

    try {
      /* ١. الفحصُ والتسجيل — والأشهرُ التي أوقفتها المهلة تُستأنف */
      setPhase("scan");
      let r = await postJson<SyncReply>("/api/drive-sync", { apply: true, readContent: true, months: 3 });
      if (!r.ok) return fail(r.error, r.status);
      absorb(r.data, true);
      for (let guard = 0; r.data.summary.truncated && (r.data.summary.pendingMonths?.length ?? 0) > 0 && guard < 12; guard++) {
        r = await postJson<SyncReply>("/api/drive-sync", { apply: true, readContent: true, onlyMonths: r.data.summary.pendingMonths });
        if (!r.ok) return fail(r.error, r.status);
        absorb(r.data, true);
      }

      /* ٢. ما لا يُفهم اسمُه يُقرأ بمحتواه على دفعات — حتى يفرغ أو تبلغ خمسَ دفعات */
      setPhase("read");
      for (let round = 0; o.remaining > 0 && round < 5; round++) {
        r = await postJson<SyncReply>("/api/drive-sync", { apply: true, readContent: true, months: 3 });
        if (!r.ok) return fail(r.error, r.status);
        absorb(r.data, false);
      }

      /* ٣. الاستدراك: اعتمادُ ما تجتمع فيه الشروط وتسميةُ المؤرشَف */
      setPhase("tidy");
      const b = await postJson<BacklogReply>("/api/document-status", { action: "confirm-eligible" });
      if (b.ok) {
        o.approved += (b.data.approved ?? 0) + (b.data.recorded ?? 0);
        o.renamed.push(...(b.data.renamed ?? []));
      }

      setOutcome(o);
      setPhase(null);
      toast({
        tone: "ok",
        title: "تمّت المزامنة",
        body: o.newFiles === 0 && o.renamed.length === 0 && o.approved === 0
          ? "لا جديد في الدرايف، وكلُّ ما أُرشِف على الصيغة."
          : [
              o.newFiles > 0 ? `وُجد ${countNoun(o.newFiles, FILE)}` : null,
              o.autoArchived > 0 ? `أُرشِف ${countNoun(o.autoArchived, DOCUMENT)}` : null,
              o.renamed.length > 0 ? `سُمّي ${countNoun(o.renamed.length, FILE)}` : null,
            ].filter(Boolean).join(" · "),
      });
      router.refresh();
    } catch {
      fail("تعذّر الاتصال بالخادم — لم يصل الطلب. تحقّق من الشبكة ثمّ أعد المحاولة.", 0);
    }
  }

  const busy = phase !== null;

  return (
    <section aria-labelledby="sync-title" className={`rounded-2xl border bg-raised p-5 shadow-raised sm:p-6 ${tone.ring}`}>
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="flex min-w-0 flex-1 basis-72 items-start gap-3">
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${tone.chip} ${tone.ink}`}>
            <Icon className="h-5 w-5" strokeWidth={2} aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-muted">حالُ المزامنة</p>
            <h2 id="sync-title" className={`mt-0.5 text-lg font-bold leading-snug ${tone.ink}`}>{headline}</h2>
            <p className="mt-1 text-xs leading-relaxed text-ink-soft">{detail}</p>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
          {canRun ? (
            <button type="button" onClick={() => void run()} disabled={busy} className={buttonClass("primary", "lg")}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden /> : <FolderSync className="h-4 w-4" strokeWidth={2} aria-hidden />}
              {busy ? "يزامن…" : "زامن الآن"}
            </button>
          ) : state === "disconnected" && reconnect ? (
            <form action={reconnect}>
              <button type="submit" className={buttonClass("primary", "lg")}>أعد ربط الدرايف</button>
            </form>
          ) : (
            <button type="button" disabled className={buttonClass("secondary", "lg")}>زامن الآن</button>
          )}
          <p className="text-[11px] text-muted sm:text-end">
            {canRun ? "فحصٌ وقراءةٌ وأرشفةٌ وتسمية — كما تفعل الآليّة." : state === "preview" ? "لا درايف في نسخة التجربة." : "يحتاج تفويضاً من جوجل أوّلاً."}
          </p>
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-3 border-t border-line-soft pt-4 sm:grid-cols-3">
        {facts.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="text-[11px] font-bold text-muted">{f.label}</dt>
            <dd className="mt-1 text-sm font-bold">{f.value}</dd>
            {f.hint && <dd className="mt-0.5 text-[11px] text-muted">{f.hint}</dd>}
          </div>
        ))}
      </dl>

      {busy && (
        <div className="mt-4" aria-live="polite">
          <p className="text-xs font-bold text-ink-soft">{PHASE_LABEL[phase]}</p>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sunken">
            <div className="upload-bar h-full w-1/3 rounded-full bg-accent" />
          </div>
          <p className="mt-1.5 text-[11px] text-muted">قد يستغرق دقيقةً أو أكثر إن وُجدت ملفّاتٌ تُقرأ بمحتواها. لا تغلق الصفحة.</p>
        </div>
      )}

      {error && (
        <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-danger-bg px-4 py-3 text-xs text-danger">
          <CircleAlert className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
          <span className="min-w-0 flex-1 basis-56 font-bold">{error.text}</span>
          {error.auth && reconnect && (
            <form action={reconnect}>
              <button type="submit" className={buttonClass("secondary", "sm")}>أعد ربط الدرايف</button>
            </form>
          )}
        </div>
      )}

      {outcome && <OutcomePanel o={outcome} />}
    </section>
  );
}

function OutcomePanel({ o }: { o: Outcome }) {
  const rows: { label: string; value: string; href?: string; tone?: "ok" | "warn" }[] = [
    { label: "ملفّاتٌ جديدة في الدرايف", value: o.newFiles === 0 ? "لا شيء" : countNoun(o.newFiles, FILE) },
    { label: "أُرشِفت وحدها", value: String(o.autoArchived), tone: o.autoArchived > 0 ? "ok" : undefined },
    {
      label: "تنتظر مراجعتك",
      value: String(o.needsReview),
      href: o.needsReview > 0 ? "/documents?status=NEEDS_REVIEW" : undefined,
      tone: o.needsReview > 0 ? "warn" : undefined,
    },
    { label: "اعتُمد ممّا تراكم", value: String(o.approved) },
    { label: "سُمّيت على الصيغة", value: String(o.renamed.length), tone: o.renamed.length > 0 ? "ok" : undefined },
  ];
  return (
    <div className="mt-4 rounded-xl border border-line bg-sunken/50 p-4">
      <p className="flex items-center gap-2 text-[13px] font-bold text-ok">
        <CircleCheck className="h-4 w-4" strokeWidth={2} aria-hidden /> تمّت المزامنة الآن
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {rows.map((r) => (
          <div key={r.label}>
            <dt className="text-[11px] text-muted">{r.label}</dt>
            <dd className={`nums mt-0.5 text-base font-bold ${r.tone === "ok" ? "text-ok" : r.tone === "warn" ? "text-warn" : ""}`}>
              {r.href ? <Link href={r.href} className="underline underline-offset-4">{r.value}</Link> : r.value}
            </dd>
          </div>
        ))}
      </dl>
      {o.remaining > 0 && (
        <p className="mt-3 text-xs text-ink-soft">
          وبقي {countNoun(o.remaining, FILE)} لم يُقرأ بعد — يُكمَل في المزامنة القادمة، أو اضغط «زامن الآن» ثانيةً.
        </p>
      )}
      {o.failures > 0 && (
        <p className="mt-2 text-xs text-warn">تعذّرت قراءة {countNoun(o.failures, FILE)} — تجدها في «المستندات» بسببها.</p>
      )}
      {o.renamed.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-line-soft pt-3">
          {o.renamed.slice(0, 6).map((n) => (
            <li key={`${n.from}→${n.to}`} className="min-w-0">
              <span dir="ltr" className="block truncate text-end text-[11px] text-muted line-through">{n.from}</span>
              <span dir="ltr" className="block truncate text-end text-[11px] font-bold text-ink-soft">{n.to}</span>
            </li>
          ))}
          {o.renamed.length > 6 && <li className="text-[11px] text-muted">و{countNoun(o.renamed.length - 6, FILE)} غيرها في سجلّ التدقيق.</li>}
        </ul>
      )}
    </div>
  );
}
