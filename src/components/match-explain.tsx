"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  CircleAlert, CircleCheck, CircleDashed, CircleMinus, Clock3, Info, Sparkles, type LucideIcon,
} from "lucide-react";
import { Money } from "./money";
import { Badge, type Tone } from "./ui";
import { ConfirmAction, Popover, toast } from "./ui-client";
import { postJson } from "@/lib/http-client";
import { strength } from "@/lib/bank/strength";
import { ACT } from "@/lib/ui-terms";

/**
 * لماذا طُوبقت هذه الحركة؟ وكيف أتراجع؟
 *
 * كان النظام يعرض «٩٨٪» — تسميةٌ ثابتة متنكّرة في زيّ رقم، تُقرأ يقيناً
 * وليست كذلك. فيُعرَض **وصفُ الترجيح** وتحته **الأدلّة بنصّها**: من هو
 * المستفيد ولماذا، وما الذي طابق المبلغ والتاريخ.
 *
 * والتراجعُ بجانبها: من وافق على مطابقةٍ خاطئة لا يبقى أسيرها. وفي
 * السجلّ تُفتح الأدلّةُ في ورقةٍ لا داخل خليّة جدول — الخليّةُ الضيّقة
 * تقصّ الدليل وتدفع الصفوف، والورقةُ تعطيه موضعه.
 */

export interface MatchExplanation {
  transactionId: string;
  disposition: "AUTO" | "SUGGEST" | "REVIEW" | null;
  score: number | null;
  outcome: string | null;
  amountMinor: number;
  matched: boolean;
  /** حالُ الحركة الفعليّ — و«متجاهَلة» قرارٌ تامّ. */
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

interface StateLook {
  label: string;
  tone: Tone;
  icon: LucideIcon;
}

const DISPOSITION: Record<string, StateLook> = {
  AUTO: { label: "طُوبقت تلقائياً", tone: "ok", icon: Sparkles },
  SUGGEST: { label: "اقتراح ينتظر تأكيدك", tone: "warn", icon: Clock3 },
  REVIEW: { label: "تنتظر مراجعتك", tone: "danger", icon: CircleAlert },
};

/**
 * الشارةُ تُشتقّ من الحال، لا من عمودٍ قديم.
 *
 * `match_disposition` عمودٌ عن **آخر ما رجّحه المحرّك**، لا عن حال الحركة
 * اليوم — فحوالةٌ واردة أُعلن أنّها ليست سداداً كانت تُعرَض «تنتظر
 * مراجعتك» بالأحمر. فالترتيبُ هو ترتيبُ ما تصير به الحركة إلى حالها:
 * متجاهَلةٌ ← مقيَّدةٌ بدفعة ← حُسمت بلا مال ← ترجيحٌ ينتظر. ولم يُمَسّ
 * محرّكُ المطابقة: التغييرُ في قراءة الحال لا في تقريره.
 */
export function stateOf(match: MatchExplanation): StateLook | null {
  const decided = match.lifecycle === "CONFIRMED" || match.lifecycle === "POSTED";
  if (isNotAPayment(match)) return { label: "أُعلنت ليست سداداً", tone: "muted", icon: CircleMinus };
  if (match.matched) {
    return match.disposition === "AUTO"
      ? DISPOSITION.AUTO
      : { label: "سُجّلت سداداً", tone: "ok", icon: CircleCheck };
  }
  if (decided) return { label: "حُسمت بلا قيد", tone: "ok", icon: CircleDashed };
  return match.disposition ? DISPOSITION[match.disposition] : null;
}

/**
 * «متجاهَلة» حالٌ لا سبب — و`NOT_A_PAYMENT` سببٌ واحدٌ من أسبابها. ويُبقى
 * السببُ في الشرط كي لا يسقط صفٌّ قديمٌ لم يُكتب حالُه.
 */
function isNotAPayment(match: MatchExplanation): boolean {
  return !match.matched && (match.status === "IGNORED" || match.outcome === "NOT_A_PAYMENT");
}

export function MatchExplain({
  match,
  canUndo = true,
  inline = false,
  title,
}: {
  match: MatchExplanation;
  /** الردّ بصلاحية «اعتماد السداد» — ومن لا يملكها لا يُعرَض له زرٌّ يردّه الخادم. */
  canUndo?: boolean;
  /** الأدلّة ظاهرةٌ في موضعها (بطاقة الحركة المطلوبة) لا في ورقة. */
  inline?: boolean;
  /** اسمُ الجهة — عنوانُ الورقة. */
  title?: string;
}) {
  const d = stateOf(match);

  if (inline) {
    return (
      <div className="space-y-3">
        <StateLine look={d} score={match.score} />
        <Evidence match={match} />
        <UndoAction match={match} canUndo={canUndo} />
      </div>
    );
  }

  /*
    الأدلّةُ بجانب الشارة لا في ورقةٍ تغطّي السجلّ: سؤالٌ صغير («لماذا؟»)
    جوابُه قائمةٌ قصيرة وزرُّ تراجع. تُغلَق بالنقر خارجها أو بـEscape.
  */
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      {d && (
        <Badge tone={d.tone}>
          <d.icon className="h-3 w-3" strokeWidth={2.25} aria-hidden />
          {d.label}
        </Badge>
      )}
      <Popover
        width="26rem"
        buttonClassName="relative z-10 inline-flex min-h-11 items-center gap-1 rounded-md px-1.5 text-[11px] font-bold text-muted transition-colors hover:bg-hover hover:text-ink sm:min-h-7"
        button={
          <>
            <Info className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            لماذا؟
          </>
        }
      >
        {(close) => (
          <div className="space-y-3 text-start">
            <div>
              <p className="text-[13px] font-bold">{title ? `لماذا: ${title}` : "لماذا هذا الحال؟"}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted">الأدلّةُ كما حُفظت مع القرار — ترجيحٌ لا يقين.</p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-sunken px-3.5 py-2.5">
              <StateLine look={d} score={match.score} />
              <span className="text-base font-bold"><Money minor={match.amountMinor} currency /></span>
            </div>
            <Evidence match={match} />
            <UndoAction match={match} canUndo={canUndo} onDone={close} />
          </div>
        )}
      </Popover>
    </span>
  );
}

function StateLine({ look, score }: { look: StateLook | null; score: number | null }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      {look ? (
        <Badge tone={look.tone}>
          <look.icon className="h-3 w-3" strokeWidth={2.25} aria-hidden />
          {look.label}
        </Badge>
      ) : (
        <Badge>لا ترجيحَ محفوظ</Badge>
      )}
      {score !== null && <span className="text-xs text-muted">{strength(score)}</span>}
    </span>
  );
}

function Evidence({ match }: { match: MatchExplanation }) {
  const ev = match.evidence;
  const has = ev && (ev.تصنيف || (ev.مستفيد?.length ?? 0) > 0 || (ev.مطابقة?.length ?? 0) > 0);
  if (!has) {
    return (
      <p className="rounded-xl border border-dashed border-line px-4 py-3 text-xs leading-relaxed text-muted">
        لم تُحفَظ أدلّةٌ لهذه الحركة — استُوردت قبل أن يبدأ حفظُها، أو صُنّفت بقاعدةٍ لا بترجيح.
      </p>
    );
  }
  return (
    <dl className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised">
      {ev.تصنيف && <EvidenceRow label="ما هي" items={[ev.تصنيف]} />}
      {ev.مستفيد && ev.مستفيد.length > 0 && (
        <EvidenceRow
          label="المستفيد"
          items={ev.مستفيد}
          note={ev.درجةالمستفيد !== undefined ? `ترجيح ${ev.درجةالمستفيد} من مئة` : undefined}
        />
      )}
      {ev.مطابقة && ev.مطابقة.length > 0 && <EvidenceRow label="لماذا هذه الفاتورة" items={ev.مطابقة} />}
    </dl>
  );
}

function EvidenceRow({ label, items, note }: { label: string; items: readonly string[]; note?: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-1 px-4 py-3 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-[11px] font-bold text-muted">{label}</dt>
      <dd className="min-w-0">
        <ul className="space-y-1">
          {items.map((r, i) => (
            <li key={i} className="flex gap-2 text-xs leading-relaxed" dir="auto">
              <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-muted" />
              <span className="min-w-0">{r}</span>
            </li>
          ))}
        </ul>
        {note && <p className="mt-1 text-[11px] text-muted">{note}</p>}
      </dd>
    </div>
  );
}

/**
 * التراجع — بإقرارٍ لا بنقرتين، وينتظر ردَّ الخادم قبل أن يقول شيئاً.
 * ولا يُعرَض إلّا لما يُردّ فعلاً: مطابقةٌ مقيَّدة، أو إعلانُ «ليست سداداً».
 */
function UndoAction({ match, canUndo, onDone }: { match: MatchExplanation; canUndo: boolean; onDone?: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const notAPayment = isNotAPayment(match);
  if (!canUndo || !(match.matched || notAPayment)) return null;

  return (
    <div>
      <ConfirmAction
        label={notAPayment ? "تراجع عن «ليست سداداً»" : "تراجع عن المطابقة"}
        title={notAPayment ? "أعِد الحركة إلى الطابور؟" : "فُكَّ هذه المطابقة؟"}
        consequence={
          notAPayment
            ? "يعود بابُ الحركة إلى ما كان قبل الإعلان، وتعود إلى الطابور تنتظر قراراً: من الجهة، وأيّ فاتورة. لا يُكتب مالٌ الآن، ويُكتب الردّ في سجلّ التدقيق باسمك."
            : "ستُفكّ التخصيصات، وتُردّ الدفعة وتبقى في السجلّ مردودةً بسببها، وتعود الفاتورة مستحقّة. ويُكتب ذلك في سجلّ التدقيق باسمك."
        }
        acknowledgement={
          notAPayment
            ? "فهمتُ أنّ الحركة تعود إلى الطابور بلا بابٍ محسوم"
            : "فهمتُ أنّ الفاتورة تعود مستحقّةً حتى تُطابَق من جديد"
        }
        confirmLabel={notAPayment ? ACT.restoreToQueue : ACT.undoMatch}
        onConfirm={async () => {
          setError(null);
          const r = await postJson<{ message?: string }>("/api/match-undo", {
            transactionId: match.transactionId,
            reason: "تراجع من الشاشة",
          });
          if (!r.ok) {
            setError(r.error);
            return false;
          }
          toast({ tone: "ok", title: r.data.message ?? "فُكّت المطابقة" });
          onDone?.();
          router.refresh();
          return true;
        }}
      />
      {error && (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs font-bold text-danger">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}
