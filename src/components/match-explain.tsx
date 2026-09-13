"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Money } from "./money";
import { Badge, buttonClass } from "./ui";
import { postJson } from "@/lib/http-client";
import { strength } from "@/lib/bank/strength";

/**
 * لماذا طُوبقت هذه الحركة؟ وكيف أتراجع؟
 *
 * كان النظام يعرض «٩٨٪» — وهي تسميةٌ ثابتة متنكّرة في زيّ رقم، تُقرأ
 * يقيناً وليست كذلك. فصار يُعرَض **وصفُ الترجيح** وتحته **الأدلّة
 * بنصّها**: من هو المستفيد ولماذا، وما الذي طابق المبلغ والتاريخ، وهل
 * كان هناك مرشّح آخر قريب.
 *
 * والتراجع بجانبها: من وافق على مطابقة خاطئة لا يبقى أسيرها.
 */

export interface MatchExplanation {
  transactionId: string;
  disposition: "AUTO" | "SUGGEST" | "REVIEW" | null;
  score: number | null;
  outcome: string | null;
  amountMinor: number;
  matched: boolean;
  evidence: {
    تصنيف?: string;
    مستفيد?: string[];
    مطابقة?: string[];
    درجةالمستفيد?: number;
  } | null;
}

const DISPOSITION: Record<string, { label: string; tone: "ok" | "warn" | "danger" }> = {
  AUTO: { label: "طُوبقت تلقائياً", tone: "ok" },
  SUGGEST: { label: "اقتراح ينتظر تأكيدك", tone: "warn" },
  REVIEW: { label: "تنتظر مراجعتك", tone: "danger" },
};

export function MatchExplain({ match }: { match: MatchExplanation }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function undo() {
    setUndoing(true);
    setFailed(false);
    try {
      const r = await postJson<{ message?: string }>("/api/match-undo", {
        transactionId: match.transactionId,
        reason: "تراجع من الشاشة",
      });
      if (!r.ok) {
        setFailed(true);
        setMessage(r.error);
      } else {
        setMessage(r.data.message ?? "فُكّت المطابقة");
        router.refresh();
      }
    } finally {
      setUndoing(false);
      setConfirming(false);
    }
  }

  /*
    ما قُيّد بدفعةٍ انتهى أمره — وكان قرارُ المطابقة القديم يبقى «تنتظر
    مراجعتك» بالأحمر على حركاتٍ مقيَّدة، والطابور فارغ.
  */
  const d = match.matched && match.disposition !== "AUTO"
    ? { label: "مقيَّدة بدفعة", tone: "ok" as const }
    : match.disposition ? DISPOSITION[match.disposition] : null;

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        {d && <Badge tone={d.tone}>{d.label}</Badge>}
        {match.score !== null && (
          <span className="text-[11px] text-muted">{strength(match.score)}</span>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="text-[11px] text-muted underline decoration-dotted underline-offset-4 hover:text-ink-soft"
        >
          {open ? "أخفِ السبب" : "لماذا؟"}
        </button>
      </div>

      {open && (
        <div className="mt-2.5 rounded-xl border border-line bg-sunken px-3 py-2.5">
          {match.evidence?.تصنيف && (
            <Row label="ما هي" value={match.evidence.تصنيف} />
          )}

          {match.evidence?.مستفيد && match.evidence.مستفيد.length > 0 && (
            <Row
              label="المستفيد"
              value={match.evidence.مستفيد.join(" · ")}
              note={
                match.evidence.درجةالمستفيد !== undefined
                  ? `ترجيح ${match.evidence.درجةالمستفيد} من مئة`
                  : undefined
              }
            />
          )}

          {match.evidence?.مطابقة && match.evidence.مطابقة.length > 0 && (
            <div className="mt-2">
              <p className="text-[11px] text-muted">لماذا هذه الفاتورة</p>
              <ul className="mt-1 space-y-1">
                {match.evidence.مطابقة.map((r, i) => (
                  <li key={i} className="text-[11px] leading-relaxed">— {r}</li>
                ))}
              </ul>
            </div>
          )}

          {!match.evidence && (
            <p className="text-[11px] text-muted">
              لم تُحفَظ أدلّة لهذه الحركة — استُوردت قبل أن يبدأ حفظها.
            </p>
          )}

          <p className="mt-2.5 border-t border-line pt-2 text-[11px] leading-relaxed text-muted">
            المبلغ <Money minor={match.amountMinor} /> ريالاً. والدرجة ترجيحٌ لا يقين،
            ولذلك تُعرَض وصفاً لا نسبة.
          </p>

          {match.matched && (
            <div className="mt-2.5">
              {!confirming ? (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  className={buttonClass("danger", "sm")}
                >
                  تراجع عن المطابقة
                </button>
              ) : (
                <div className="rounded-lg border border-danger/40 bg-danger-bg p-2.5">
                  <p className="text-[11px] leading-relaxed">
                    ستُفكّ التخصيصات، وتُردّ الدفعة وتبقى في السجلّ مردودةً بسببها، وتعود
                    الفاتورة مستحقّة. ويُكتب ذلك في سجلّ التدقيق باسمك.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={undoing}
                      onClick={undo}
                      className={buttonClass("danger", "sm")}
                    >
                      {undoing ? "يُفكّ…" : "أكّد التراجع"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(false)}
                      className={buttonClass("quiet", "sm")}
                    >
                      إلغاء
                    </button>
                  </div>
                </div>
              )}
              {message && (
                <p className={`mt-2 text-[11px] ${failed ? "text-danger" : "text-ok"}`}>{message}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="mt-2 first:mt-0">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="text-[11px] leading-relaxed">{value}</p>
      {note && <p className="text-[11px] text-muted">{note}</p>}
    </div>
  );
}
