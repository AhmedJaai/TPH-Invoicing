"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import { Money } from "./money";
import { Badge, type Tone } from "./ui";
import { buttonClass } from "./ui-tokens";
import { useRouter } from "next/navigation";
import { formatRiyalsDisplay } from "@/lib/money";
import {
  FINDING_LABEL,
  SEVERITY_LABEL,
  type FindingAction,
  type FindingKind,
  type Severity,
} from "@/lib/ai/finding-labels";
import { SUGGESTION, countNoun } from "@/lib/arabic";
import { ACT } from "@/lib/ui-terms";

/**
 * اقتراحاتُ تحليل الذكاء — وقرارُ صاحب العمل فيها.
 *
 * كلّ اقتراحٍ يقول ما وجده ولماذا، ومبلغُه محسوبٌ في الخادم. وله فعلٌ
 * واحد إن كان يمسّ المال — يُعايَن قبل الإقرار — أو «صحيح / ليس صحيحاً»
 * إن كان معلومة. والرفض يُقرأ في التحليل القادم فلا يعود بلا دليل.
 */

export interface FindingView {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierSlug: string;
  kind: string;
  severity: string;
  title: string;
  explanation: string;
  amountMinor: number | null;
  action: FindingAction | null;
  refs: { label: string; type: string }[];
  createdAt: string;
}

interface OwnerPreview {
  invoiceNumber: string;
  ownerPaymentMinor: number;
  freed: { amountMinor: number }[];
  reapplied: { invoiceNumber: string; amountMinor: number }[];
  creditLeftMinor: number;
}

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> } | null> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    return null;
  }
  const text = await res.text().catch(() => "");
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    /* صفحة خطأٍ من المنصّة لا JSON */
  }
  return { ok: res.ok, status: res.status, data };
}

const errorOf = (r: Awaited<ReturnType<typeof postJson>>) =>
  r === null
    ? "تعذّر الاتصال بالخادم — لم يصل الطلب."
    : String(r.data.error ?? (r.status === 504 ? "تأخّر الخادم — أعد المحاولة" : `ردّ الخادم بالرمز ${r.status}`));

const SEVERITY_TONE: Record<string, Tone | undefined> = {
  HIGH: "danger",
  MEDIUM: "warn",
  LOW: undefined,
};

/* شريطُ الحدّة على حافّة البطاقة — ومعه كلمتُها في الشارة، فاللونُ لا يأتي وحده */
const SEVERITY_EDGE: Record<string, string> = {
  HIGH: "before:bg-danger",
  MEDIUM: "before:bg-warn",
  LOW: "before:bg-line",
};

/* ───────────────────── زرّ التحليل ───────────────────── */

export function RunAnalysis({
  suppliers,
  label,
}: {
  suppliers: { id: string; name: string }[];
  label: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [lines, setLines] = useState<{ name: string; text: string; bad: boolean }[]>([]);

  async function run() {
    setBusy(true);
    setLines([]);
    /*
      مورّدٌ في كلّ طلب — لا طلبٌ واحد للكلّ. الطلب الطويل يقتله المزوّد
      عند ستّين ثانية صامتاً، والمورّد الواحد تحتها.
    */
    for (let k = 0; k < suppliers.length; k++) {
      const s = suppliers[k];
      setProgress(suppliers.length > 1 ? `يحلّل ${k + 1} من ${suppliers.length} — ${s.name}` : "يحلّل… قد يستغرق نصف دقيقة");
      const r = await postJson("/api/ai-analysis", { supplierId: s.id });
      const text = r && r.ok
        ? `${String(r.data.summary ?? "")}${Number(r.data.count ?? 0) > 0 ? ` — ${countNoun(Number(r.data.count ?? 0), SUGGESTION)}` : ""}`
        : errorOf(r);
      setLines((prev) => [...prev, { name: s.name, text, bad: !(r && r.ok) }]);
      if (r && r.status === 402) break; // الرصيد نفد — لا فائدة من الباقي
    }
    setProgress(null);
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={run}
        disabled={busy || suppliers.length === 0}
        className={buttonClass("secondary", "sm")}
      >
        <Sparkles className={`h-4 w-4 text-accent ${busy ? "animate-pulse" : ""}`} strokeWidth={2} aria-hidden />
        {busy ? "يحلّل…" : label}
      </button>
      {progress && <p className="text-xs text-muted" aria-live="polite">{progress}</p>}
      {lines.length > 0 && (
        <ul className="space-y-1.5" aria-live="polite">
          {lines.map((l, k) => (
            <li key={k} className={`text-xs leading-relaxed ${l.bad ? "text-danger" : "text-ink-soft"}`}>
              {suppliers.length > 1 && <span className="font-bold">{l.name}: </span>}
              {l.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ───────────────────── الاقتراحات ───────────────────── */

export function FindingsList({
  findings,
  canApprove,
  showSupplier,
  collapseAfter,
}: {
  findings: FindingView[];
  canApprove: boolean;
  showSupplier: boolean;
  /** كم اقتراحاً يُعرض قبل «اعرض الباقي» — الأشدُّ أوّلاً. */
  collapseAfter?: number;
}) {
  const [all, setAll] = useState(false);
  if (findings.length === 0) return null;
  /* الأشدُّ أوّلاً، ثمّ الأكبرُ مالاً: ما يُطوى هو الأخفّ */
  const rank = (f: FindingView) => (f.severity === "HIGH" ? 0 : f.severity === "MEDIUM" ? 1 : 2);
  const sorted = [...findings].sort((a, b) => rank(a) - rank(b) || (b.amountMinor ?? 0) - (a.amountMinor ?? 0));
  const limit = collapseAfter !== undefined && !all ? collapseAfter : sorted.length;
  const hidden = sorted.length - limit;
  return (
    <>
      <ul className="grid gap-3 xl:grid-cols-2">
        {sorted.slice(0, limit).map((f) => (
          <li key={f.id} className="min-w-0">
            <FindingCard finding={f} canApprove={canApprove} showSupplier={showSupplier} />
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="mt-3 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line text-xs font-medium text-ink-soft transition-colors hover:border-accent-line hover:text-accent"
        >
          اعرض {countNoun(hidden, SUGGESTION)} {hidden === 1 ? "آخر" : "أخرى"}
          <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
        </button>
      )}
    </>
  );
}

function FindingCard({
  finding: f,
  canApprove,
  showSupplier,
}: {
  finding: FindingView;
  canApprove: boolean;
  showSupplier: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "preview" | "dismissing" | "done">("idle");
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);
  const [preview, setPreview] = useState<OwnerPreview | null>(null);
  const [note, setNote] = useState("");

  const kindLabel = FINDING_LABEL[f.kind as FindingKind] ?? f.kind;
  const severityLabel = SEVERITY_LABEL[f.severity as Severity] ?? f.severity;
  const moneyAction = f.action !== null;

  async function decide(decision: "preview" | "accept" | "dismiss") {
    setState("busy");
    setMessage(null);
    const r = await postJson("/api/ai-findings", { findingId: f.id, decision, note: note || null });
    if (!r || !r.ok) {
      setMessage({ text: errorOf(r), bad: true });
      setState(decision === "dismiss" ? "dismissing" : preview ? "preview" : "idle");
      return;
    }
    if (decision === "preview") {
      setPreview((r.data.preview as OwnerPreview | null) ?? null);
      setState("preview");
      return;
    }
    setMessage({ text: String(r.data.message ?? "حُفظ"), bad: false });
    setState("done");
    router.refresh();
  }

  return (
    <article
      className={`relative flex h-full flex-col overflow-hidden rounded-xl border border-line bg-raised p-4 shadow-raised before:absolute before:inset-y-0 before:start-0 before:w-1 sm:p-5 ${SEVERITY_EDGE[f.severity] ?? SEVERITY_EDGE.LOW}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={SEVERITY_TONE[f.severity]} dot>{severityLabel}</Badge>
        <span className="text-[11px] font-medium text-muted">{kindLabel}</span>
        {showSupplier && (
          <Link href={`/suppliers/${f.supplierSlug}`} className="text-[11px] font-bold text-ink-soft hover:text-accent hover:underline hover:underline-offset-2">
            {f.supplierName}
          </Link>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="min-w-0 text-sm font-bold leading-relaxed">{f.title}</h3>
        {f.amountMinor !== null && (
          <span className="shrink-0 text-base font-bold"><Money minor={f.amountMinor} /></span>
        )}
      </div>
      {f.explanation && <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">{f.explanation}</p>}

      {f.refs.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {f.refs.map((r, k) => (
            <li key={k} className="rounded-md border border-line-soft bg-sunken px-2 py-0.5 text-[11px] text-ink-soft" dir="auto">
              {r.label}
            </li>
          ))}
        </ul>
      )}

      {state === "preview" && preview && (
        <p className="mt-3 rounded-lg border border-warn/25 bg-warn-bg p-3 text-xs leading-relaxed">
          تُقيَّد فاتورة {preview.invoiceNumber} مسدَّدةً من حسابك بـ{formatRiyalsDisplay(preview.ownerPaymentMinor)}
          {preview.freed.length > 0 && (
            <>
              {" · "}وتُفَكّ عنها حوالاتُ المقهى ({formatRiyalsDisplay(preview.freed.reduce((s, x) => s + x.amountMinor, 0))})
              {preview.reapplied.length > 0 && (
                <> وتُخصم من: {preview.reapplied.map((x) => `فاتورة ${x.invoiceNumber} بـ${formatRiyalsDisplay(x.amountMinor)}`).join("، ")}</>
              )}
            </>
          )}
          {preview.creditLeftMinor > 0 && <> · ويبقى لك عنده {formatRiyalsDisplay(preview.creditLeftMinor)}</>}
        </p>
      )}

      {state === "dismissing" && (
        <label className="mt-3 block text-xs">
          <span className="text-muted">لماذا ليس صحيحاً؟ (اختياريّ — يتعلّم منه التحليل القادم)</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            className="mt-1 block min-h-11 w-full rounded-lg border border-line-input bg-surface px-3 text-sm"
            placeholder="مثلاً: سدّدتُها بحوالةٍ من حسابٍ آخر"
          />
        </label>
      )}

      {state !== "done" && (
        <div className="mt-auto flex flex-wrap gap-2 pt-4">
          {state === "dismissing" ? (
            <>
              <button type="button" className={buttonClass("secondary", "sm")} onClick={() => decide("dismiss")}>
                احفظ الرفض
              </button>
              <button type="button" className={buttonClass("quiet", "sm")} onClick={() => setState("idle")}>تراجع</button>
            </>
          ) : moneyAction ? (
            <>
              {f.action?.type === "OWNER_PAID" && state !== "preview" && (
                <button type="button" disabled={state === "busy"} className={buttonClass("secondary", "sm")} onClick={() => decide("preview")}>
                  {state === "busy" ? "يحسب…" : "عاين ما سيتغيّر"}
                </button>
              )}
              {(f.action?.type !== "OWNER_PAID" || state === "preview") && (
                <button
                  type="button"
                  disabled={state === "busy" || !canApprove}
                  className={buttonClass("primary", "sm")}
                  onClick={() => decide("accept")}
                  title={canApprove ? undefined : "إقرار ما يكتب سداداً لمن يعتمد السداد"}
                >
                  {state === "busy" ? "يحفظ…" : f.action?.type === "OWNER_PAID" ? ACT.paidFromOwner : f.action?.type === "VOID_DUPLICATE" ? "هي دفعةٌ واحدة — ألغِ المكرّرة" : "اخصم الرصيد من فواتيره"}
                </button>
              )}
              <button type="button" disabled={state === "busy"} className={buttonClass("quiet", "sm")} onClick={() => setState("dismissing")}>
                ليس صحيحاً
              </button>
            </>
          ) : (
            <>
              <button type="button" disabled={state === "busy"} className={buttonClass("secondary", "sm")} onClick={() => decide("accept")}>
                صحيح — عُلم
              </button>
              <button type="button" disabled={state === "busy"} className={buttonClass("quiet", "sm")} onClick={() => setState("dismissing")}>
                ليس صحيحاً
              </button>
            </>
          )}
        </div>
      )}

      {!canApprove && moneyAction && state !== "done" && (
        <p className="mt-2 text-[11px] text-muted">إقرار هذا يكتب سداداً — يحتاج صلاحية اعتماد السداد.</p>
      )}
      {message && (
        <p className={`mt-2 text-xs font-bold ${message.bad ? "text-danger" : "text-ok"}`} role={message.bad ? "alert" : "status"}>
          {message.bad ? "" : "✓ "}{message.text}
        </p>
      )}
    </article>
  );
}
