"use client";

import Link from "next/link";
import { useState } from "react";
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

const SEVERITY_SKIN: Record<string, string> = {
  HIGH: "border-danger/40 bg-danger-bg text-danger",
  MEDIUM: "border-warn/40 bg-warn-bg text-warn",
  LOW: "border-line bg-sunken text-ink-soft",
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
        className="inline-flex min-h-11 items-center justify-center rounded-xl bg-inverse-surface px-4 py-2.5 text-sm font-bold text-inverse-ink disabled:opacity-50"
      >
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
}: {
  findings: FindingView[];
  canApprove: boolean;
  showSupplier: boolean;
}) {
  if (findings.length === 0) return null;
  return (
    <ul className="space-y-3">
      {findings.map((f) => (
        <li key={f.id}>
          <FindingCard finding={f} canApprove={canApprove} showSupplier={showSupplier} />
        </li>
      ))}
    </ul>
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

  const btn = "inline-flex min-h-10 items-center justify-center rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-50";

  return (
    <article className="rounded-2xl border border-line bg-raised p-4 shadow-raised">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${SEVERITY_SKIN[f.severity] ?? SEVERITY_SKIN.LOW}`}>
          {severityLabel}
        </span>
        <span className="text-[11px] font-medium text-muted">{kindLabel}</span>
        {showSupplier && (
          <Link href={`/suppliers/${f.supplierSlug}`} className="text-[11px] font-bold underline underline-offset-2">
            {f.supplierName}
          </Link>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-sm font-bold leading-relaxed">{f.title}</h3>
        {f.amountMinor !== null && (
          <span className="nums shrink-0 text-base font-bold" dir="ltr">{formatRiyalsDisplay(f.amountMinor)}</span>
        )}
      </div>
      {f.explanation && <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">{f.explanation}</p>}

      {f.refs.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {f.refs.map((r, k) => (
            <li key={k} className="nums rounded-lg border border-line bg-sunken px-2 py-0.5 text-[11px] text-ink-soft">
              {r.label}
            </li>
          ))}
        </ul>
      )}

      {state === "preview" && preview && (
        <p className="mt-3 rounded-xl border border-warn/40 bg-warn-bg p-3 text-xs leading-relaxed">
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
            className="mt-1 block min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm"
            placeholder="مثلاً: سدّدتُها بحوالةٍ من حسابٍ آخر"
          />
        </label>
      )}

      {state !== "done" && (
        <div className="mt-3 flex flex-wrap gap-2">
          {state === "dismissing" ? (
            <>
              <button type="button" className={`${btn} border border-line`} onClick={() => decide("dismiss")}>
                احفظ الرفض
              </button>
              <button type="button" className={`${btn} text-ink-soft`} onClick={() => setState("idle")}>تراجع</button>
            </>
          ) : moneyAction ? (
            <>
              {f.action?.type === "OWNER_PAID" && state !== "preview" && (
                <button type="button" disabled={state === "busy"} className={`${btn} border border-line`} onClick={() => decide("preview")}>
                  {state === "busy" ? "يحسب…" : "عاين ما سيتغيّر"}
                </button>
              )}
              {(f.action?.type !== "OWNER_PAID" || state === "preview") && (
                <button
                  type="button"
                  disabled={state === "busy" || !canApprove}
                  className={`${btn} bg-inverse-surface text-inverse-ink`}
                  onClick={() => decide("accept")}
                  title={canApprove ? undefined : "إقرار ما يكتب سداداً لمن يعتمد السداد"}
                >
                  {state === "busy" ? "يحفظ…" : f.action?.type === "OWNER_PAID" ? ACT.paidFromOwner : f.action?.type === "VOID_DUPLICATE" ? "هي دفعةٌ واحدة — ألغِ المكرّرة" : "اخصم الرصيد من فواتيره"}
                </button>
              )}
              <button type="button" disabled={state === "busy"} className={`${btn} text-ink-soft`} onClick={() => setState("dismissing")}>
                ليس صحيحاً
              </button>
            </>
          ) : (
            <>
              <button type="button" disabled={state === "busy"} className={`${btn} border border-line`} onClick={() => decide("accept")}>
                صحيح — عُلم
              </button>
              <button type="button" disabled={state === "busy"} className={`${btn} text-ink-soft`} onClick={() => setState("dismissing")}>
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
