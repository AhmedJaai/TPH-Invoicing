"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ScanText } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { ITEM, countNoun } from "@/lib/arabic";
import { buttonClass } from "./ui-tokens";
import { toast } from "./ui-client";
import { Money } from "./money";

interface ReadLine {
  description: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
}

interface Preview {
  applied: boolean;
  model?: string;
  fileName?: string;
  read?: {
    subtotalMinor: number | null;
    vatMinor: number | null;
    totalMinor: number | null;
    sellerVat: string | null;
    buyerVat: string | null;
    lineCount: number;
    lines: ReadLine[];
  };
  linesWritten?: number;
  taxStatus?: string;
  note?: string;
  /** القراءةُ لا تستقيم — تُقال بأرقامها، ولا تُكتَب مبالغُها. */
  problem?: string | null;
}

/**
 * «أعد قراءة المستند» — معاينةً أوّلاً، ثمّ إقراراً.
 *
 * ── لماذا خطوتان ──
 *
 * لأنّ القراءة تكتب مالاً: مبالغَ وبنوداً وأرقامَ ضريبة. وقراءةٌ ثانية
 * قد تكون أسوأ من الأولى — نموذجٌ يقرأ صورةً ممسوحة قد يخطئ خانةً.
 * فتُعرَض أوّلاً ويُقارنها الإنسانُ بالملفّ، ثمّ يُقرّها.
 *
 * وهو قيدٌ قائم في المشروع: «الكتابة من planned وحده، والاقتراح لا
 * يُكتَب ينتظر تأكيداً».
 *
 * **ورقمُ الفاتورة لا يُؤخَذ من النموذج** — اختلق مرّةً `TPH-20260521`
 * بثقة ١٫٠٠. فيبقى على ما قُيِّد، ومن أراد تصحيحه كتبه بيده.
 */
export function DocumentReread({
  documentId,
  canEdit,
}: {
  documentId: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!canEdit) return null;

  async function run(apply: boolean) {
    setBusy(true);
    setError(null);
    const r = await postJson<Preview>("/api/document-reread", { documentId, apply });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    if (apply) {
      setPreview(null);
      const text =
        `كُتبت القراءة — ${countNoun(r.data.linesWritten ?? 0, ITEM)}.`
        + (r.data.taxStatus === "VALID" ? " وصارت الفاتورة مستوفيةَ الأركان." : "")
        + (r.data.problem ? ` ${r.data.problem}` : "");
      setDone(text);
      toast({ tone: r.data.problem ? "warn" : "ok", title: "أُقرّت القراءة الجديدة", body: text });
      router.refresh();
      return;
    }
    setPreview(r.data);
  }

  return (
    <div className="space-y-2.5">
      {!preview && (
        <button
          type="button"
          onClick={() => run(false)}
          disabled={busy}
          className={buttonClass("secondary", "sm")}
        >
          <ScanText className={`h-3.5 w-3.5 ${busy ? "animate-pulse" : ""}`} strokeWidth={2} aria-hidden />
          {busy ? "يقرأ المستند… (حتى دقيقة)" : "أعد قراءة المستند"}
        </button>
      )}

      {error && (
        <p className="rounded-lg border border-danger/40 bg-danger-bg px-3 py-2 text-[11px] leading-relaxed text-danger" role="alert">
          {error}
        </p>
      )}
      {done && <p role="status" className="text-xs font-bold text-ok">{done}</p>}

      {preview?.read && (
        <div className="w-full rounded-xl border border-accent-line bg-raised p-3.5 shadow-raised">
          <p className="text-xs font-bold">ما قرأه النموذج الآن — لم يُكتَب بعد</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{preview.note}</p>
          {preview.problem && (
            <p className="mt-2 rounded-lg bg-warn-bg px-2.5 py-1.5 text-[11px] leading-relaxed text-warn" role="status">
              {preview.problem}
            </p>
          )}

          <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] sm:grid-cols-3">
            <Pair label="الصافي" value={money(preview.read.subtotalMinor)} />
            <Pair label="الضريبة" value={money(preview.read.vatMinor)} />
            <Pair label="الإجماليّ" value={money(preview.read.totalMinor)} />
            <Pair label="ضريبيّ البائع" value={preview.read.sellerVat ?? "لم يُقرأ"} />
            <Pair label="ضريبيّ المشتري" value={preview.read.buyerVat ?? "لم يُقرأ"} />
            <Pair label="البنود" value={<span className="nums">{preview.read.lineCount}</span>} />
          </dl>

          {preview.read.lines.length > 0 ? (
            <ul className="mt-2.5 max-h-48 space-y-1 overflow-y-auto border-s-2 border-line ps-2.5">
              {preview.read.lines.map((l, i) => (
                <li key={i} className="flex justify-between gap-3 text-[11px]">
                  <span className="min-w-0 truncate" dir="auto">{l.description}</span>
                  <span className="nums shrink-0 text-muted">
                    {l.quantity} × {l.unitPrice || "—"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            /*
              قراءةٌ ثانية بلا بنودٍ خبرٌ لا فشل: قد يكون المستندُ صورةً
              لا تُقرأ بنودُها. وقولُ ذلك أصدق من كتابة صفرٍ ثانية.
            */
            <p className="mt-2.5 text-[11px] leading-relaxed text-warn">
              لم تُقرأ بنودٌ هذه المرّة أيضاً — الأرجح أنّ المستند صورةٌ لا يُقرأ تفصيلُها.
              اكتب ما تحتاجه بيدك، أو اطلب من المورّد نسخةً أوضح.
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => run(true)}
              disabled={busy}
              className={buttonClass("primary", "sm")}
            >
              {busy ? "يكتب…" : "أقرّ هذه القراءة"}
            </button>
            <button
              type="button"
              onClick={() => setPreview(null)}
              disabled={busy}
              className={buttonClass("quiet", "sm")}
            >
              تجاهلها
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Pair({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted">{label}</dt>
      <dd className="truncate font-bold">{value}</dd>
    </div>
  );
}

/** المجهول يبقى مجهولاً — ولا يُكتَب صفراً. */
function money(minor: number | null): React.ReactNode {
  if (minor === null) return <span className="font-normal text-muted">لم يُقرأ</span>;
  return <Money minor={minor} />;
}
