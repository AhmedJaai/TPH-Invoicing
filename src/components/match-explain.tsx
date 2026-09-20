"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Money } from "./money";
import { Badge, buttonClass } from "./ui";
import { postJson } from "@/lib/http-client";
import { strength } from "@/lib/bank/strength";
import { ACT } from "@/lib/ui-terms";

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
  /** حالُ الحركة الفعليّ — و«متجاهَلة» قرارٌ تامّ. انظر أدناه. */
  status?: "UNMATCHED" | "MATCHED" | "IGNORED" | "PARTIAL" | "DISPUTED" | null;
  /** أين تقف من الطبقات — وما بلغ الحسمَ لا يُسأل عنه. */
  lifecycle?: "RAW" | "INFERRED" | "SUGGESTED" | "CONFIRMED" | "POSTED" | null;
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

export function MatchExplain({
  match,
  canUndo = true,
}: {
  match: MatchExplanation;
  /** الردّ بصلاحية «اعتماد السداد» — ومن لا يملكها لا يُعرَض له زرٌّ يردّه الخادم. */
  canUndo?: boolean;
}) {
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
  /*
    «ليست سداداً» كان الخادم يردّها (match-undo) ولا زرّ لها — فمن أعلنها
    خطأً يرى الحركة خارج الطابور ولا يملك إعادتها (BTN-106).
  */
  /*
    ── الشارةُ تُشتقّ من الحال، لا من عمودٍ قديم ──

    كانت تُقرأ من `match_disposition` وحده متى لم تكن الحركة مقيَّدةً
    بدفعة. و`match_disposition` عمودٌ عن **آخر ما رجّحه المحرّك**، لا عن
    حال الحركة اليوم: يبقى فيه «مراجعة» بعد أن يبتّ الإنسانُ الأمر،
    لأنّ الذي يتغيّر حينها عمودٌ آخر.

    فوقع في قاعدة أحمد: حوالةٌ **واردة** بـ١٬١٠٠ ريالاً (٤ يوليو ٢٠٢٦)
    حالُها `IGNORED` — أي **أُعلن أنّها ليست سداداً وانتهى أمرُها** —
    وكانت تُعرَض بشارةٍ حمراء «تنتظر مراجعتك». ولم تُمسَك بالحارس
    القديم لأنّه كان يسأل عن `match_outcome = 'NOT_A_PAYMENT'`،
    ونتيجتُها `UNKNOWN_ENTITY`. فالحارسُ كان يمسك **سبباً** واحداً من
    أسباب التجاهل لا **الحالَ** نفسه.

    وشارةٌ تقول «ينتظرك عمل» عن عملٍ مقضيّ أسوأ من غياب الشارة: تُري
    صاحبَ المقهى واجباً ثمّ لا يجده في أيّ طابور، فيشكّ في الطوابير كلّها.

    فصارت تُشتقّ بالترتيب الذي تصير به الحركةُ إلى حالها:
    متجاهَلةٌ ← مقيَّدةٌ بدفعة ← حُسمت بلا مال ← ترجيحٌ ينتظر. ولم يُمَسّ
    شيءٌ من محرّك المطابقة: التغييرُ في قراءة الحال لا في تقريره.
  */
  const decided = match.lifecycle === "CONFIRMED" || match.lifecycle === "POSTED";
  /*
    «متجاهَلة» حالٌ لا سبب — و`NOT_A_PAYMENT` سببٌ واحدٌ من أسبابها.
    ويُبقى السببُ في الشرط كي لا يسقط صفٌّ قديمٌ لم يُكتب حالُه.
  */
  const notAPayment = !match.matched && (match.status === "IGNORED" || match.outcome === "NOT_A_PAYMENT");

  const d = notAPayment
    ? { label: "أُعلنت ليست سداداً", tone: "muted" as const }
    : match.matched
      ? match.disposition === "AUTO"
        ? { label: "طُوبقت تلقائياً", tone: "ok" as const }
        : { label: "سُجّلت سداداً", tone: "ok" as const }
      : decided
        ? { label: "حُسمت بلا قيد", tone: "ok" as const }
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
          className="inline-flex min-h-11 items-center px-2 text-[11px] text-muted underline decoration-dotted underline-offset-4 hover:text-ink-soft sm:min-h-0 sm:px-0"
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
            المبلغ <Money minor={match.amountMinor} /> ريالاً. وهذا ترجيح، فراجِع ما
            يبدو غريباً.
          </p>

          {canUndo && (match.matched || notAPayment) && (
            <div className="mt-2.5">
              {!confirming ? (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  className={buttonClass("danger", "sm")}
                >
                  {notAPayment ? "تراجع عن «ليست سداداً»" : "تراجع عن المطابقة"}
                </button>
              ) : (
                <div className="rounded-lg border border-danger/40 bg-danger-bg p-2.5">
                  <p className="text-[11px] leading-relaxed">
                    {notAPayment
                      ? "يعود باب الحركة إلى ما كان قبل الإعلان، وتعود إلى طابور المراجعة تنتظر قراراً: من الجهة، وأيّ فاتورة. لا يُكتب مالٌ الآن، ويُكتب الردّ في سجلّ التدقيق باسمك."
                      : "ستُفكّ التخصيصات، وتُردّ الدفعة وتبقى في السجلّ مردودةً بسببها، وتعود الفاتورة مستحقّة. ويُكتب ذلك في سجلّ التدقيق باسمك."}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={undoing}
                      onClick={undo}
                      className={buttonClass("danger", "sm")}
                    >
                      {undoing ? "يُردّ…" : notAPayment ? ACT.restoreToQueue : ACT.undoMatch}
                    </button>
                    <button
                      type="button"
                      disabled={undoing}
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
