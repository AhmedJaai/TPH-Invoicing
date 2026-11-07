"use client";

/**
 * خصومُ الحضور يوماً يوماً — بجانب كلّ تأخيرٍ أو انصرافٍ مبكّر أو غياب: كم يُحسم عنه، ومن أين جاء،
 * وما يفعله صاحبُ المقهى به: يعدّل دقائقه، أو يعفو عن جزائه ويبقى أجرُ الوقت، أو يلغيه كلَّه
 * (ويتراجع من الإشعار).
 *
 * المالُ هنا يحسبه الخادم (`lib/payroll/deductions.ts`) — والشاشةُ ترسل معرّفاً ودقائق لا مبلغاً.
 */
import { useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { Money } from "@/components/money";
import { PostAction } from "@/components/post-action";
import { postJson } from "@/lib/http-client";
import { useRouter } from "next/navigation";
import type { DeductionItem } from "@/lib/payroll/deductions";
import { buttonClass, fieldClass } from "../ui-tokens";
import { toast } from "../ui-client";

const KIND = { LATE: "تأخر", EARLY: "انصرف مبكراً", ABSENT: "غاب دون إذن", LEAVE: "إجازة أو عذر" } as const;
const ORD = ["الأولى", "الثانية", "الثالثة", "الرابعة"] as const;

const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

export interface DeductionRow extends DeductionItem {
  employeeId: string;
  /** في القائمة المجمَّعة لكلّ الموظّفين. */
  employeeName?: string;
}

export function DeductionList({ items, canEdit, salaryKnown = true }: { items: readonly DeductionRow[]; canEdit: boolean; salaryKnown?: boolean }) {
  return (
    <ul className="divide-y divide-line rounded-xl border border-line bg-raised shadow-raised">
      {items.map((i) => <Line key={i.id} item={i} canEdit={canEdit} salaryKnown={salaryKnown} />)}
    </ul>
  );
}

function Line({ item: i, canEdit, salaryKnown }: { item: DeductionRow; canEdit: boolean; salaryKnown: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [minutes, setMinutes] = useState(String(i.minutes ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const byMinutes = i.kind === "LATE" || i.kind === "EARLY";
  const total = i.wageMinor === null ? null : i.wageMinor + (i.penalty?.amountMinor ?? 0);
  const n = Number(minutes);

  async function saveMinutes() {
    if (!Number.isInteger(n) || n < 1 || n > 960) { setError("اكتب الدقائق رقماً بين 1 و960."); return; }
    if (n === i.minutes) { setEditing(false); return; }
    setBusy(true);
    setError(null);
    const r = await postJson<{ message?: string }>("/api/payroll/entry", {
      action: "day", employeeId: i.employeeId, day: i.day, kind: i.kind, minutes: n,
      disrupted: i.kind === "LATE" ? i.disrupted : undefined,
      note: `عدّلته من ${i.minutes ?? 0} إلى ${n} دقيقة`,
    });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    toast({ tone: "ok", title: `صار ${n} دقيقة، وتغيّر الخصم` });
    setEditing(false);
    router.refresh();
  }

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <p className="text-sm font-bold">
            {i.employeeName && <>{i.employeeName} · </>}{KIND[i.kind]}{byMinutes && i.minutes !== null && <> <span className="nums">{i.minutes}</span> دقيقة</>}
          </p>
          <p className="text-[11px] text-muted">
            {dayLabel(i.day)} · {i.source === "CHECKIN" ? "من تسجيل الحضور" : "سجّلته بيدك"}{i.disrupted ? " · عطّل زملاءه" : ""}{i.note && i.source === "MANUAL" ? ` · ${i.note}` : ""}
          </p>
        </div>
        <div className="shrink-0 text-end text-sm">
          {i.kind === "LEAVE" ? <span className="text-xs text-muted">لا يُخصم</span>
            : i.withinGrace ? <span className="text-xs text-muted">في حدود السماح، لا يُخصم</span>
            : total === null ? <span className="text-xs text-muted">{salaryKnown ? "غير معروف" : "الراتب غير مكتوب"}</span>
            : <span className="font-bold"><span className="text-muted">− </span><Money minor={total} /></span>}
        </div>
      </div>

      {!i.withinGrace && i.kind !== "LEAVE" && (i.wageMinor !== null || i.penalty) && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-soft">
          {i.wageMinor !== null && i.wageMinor > 0 && <>أجر {byMinutes ? "الدقائق" : "اليوم"} <span className="nums"><Money minor={i.wageMinor} /></span></>}
          {i.penalty && (
            <>
              {i.wageMinor !== null && i.wageMinor > 0 && " + "}
              {i.penalty.waived ? <span className="text-ok">عُفي عن الجزاء</span>
                : i.penalty.warning ? <>إنذار كتابي بلا خصم</>
                : i.penalty.amountMinor === null ? <span className="text-danger">يجيز الفصل (قرارك)</span>
                : <>جزاء <span className="nums"><Money minor={i.penalty.amountMinor} /></span></>}
              <span className="text-muted"> — البند {i.penalty.code}، المرة {ORD[Math.min(i.penalty.occurrence, 4) - 1]}: {i.penalty.rule}</span>
            </>
          )}
        </p>
      )}

      {canEdit && (
        editing ? (
          <form className="mt-2 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void saveMinutes(); }}>
            <label className="text-xs font-bold text-ink-soft" htmlFor={`m-${i.id}`}>الدقائق الصحيحة</label>
            <input id={`m-${i.id}`} className={`${fieldClass("sm", false)} nums w-24 text-end`} dir="ltr" inputMode="numeric" autoFocus
              value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, "").slice(0, 3))} />
            <button type="submit" className={buttonClass("primary", "sm")} disabled={busy} aria-busy={busy}><Check className="h-3.5 w-3.5" aria-hidden />احفظ</button>
            <button type="button" className={buttonClass("quiet", "sm")} onClick={() => { setEditing(false); setMinutes(String(i.minutes ?? "")); setError(null); }}><X className="h-3.5 w-3.5" aria-hidden />ألغِ</button>
            {error && <span role="alert" className="basis-full text-[11px] font-bold text-danger">{error}</span>}
          </form>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {byMinutes && (
              <button type="button" className={buttonClass("quiet", "sm")} onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" aria-hidden />عدّل الدقائق</button>
            )}
            {i.kind === "ABSENT" && (
              <PostAction url="/api/payroll/entry" body={{ action: "day", employeeId: i.employeeId, day: i.day, kind: "LEAVE", note: "غيّرته من غياب إلى إجازة أو عذر" }} variant="quiet" done="صار إجازة، ولا يُخصم عنه">اجعله إجازة أو عذراً</PostAction>
            )}
            {i.penalty && !i.penalty.warning && i.penalty.amountMinor !== null && (
              <PostAction url="/api/payroll/entry" body={{ action: "waive", id: i.id, waived: !i.penalty.waived }} variant="quiet"
                done={i.penalty.waived ? "أُعيد الجزاء" : "عُفي عن الجزاء"}>
                {i.penalty.waived ? "أعد الجزاء" : "اعفُ عن الجزاء فقط"}
              </PostAction>
            )}
            {i.penalty?.warning && (
              <PostAction url="/api/payroll/entry" body={{ action: "waive", id: i.id, waived: !i.penalty.waived }} variant="quiet"
                done={i.penalty.waived ? "أُعيد الإنذار" : "أُلغي الإنذار"}>
                {i.penalty.waived ? "أعد الإنذار" : "ألغِ الإنذار"}
              </PostAction>
            )}
            <PostAction url="/api/payroll/entry" body={{ action: "day-clear", id: i.id }} undo={{ body: { action: "day-restore", id: i.id } }}
              variant="quiet" done={i.kind === "LEAVE" ? "أُزيلت الإجازة" : "أُلغي خصم اليوم"}>
              {i.kind === "LEAVE" ? "أزل الإجازة" : "ألغِ الخصم كله"}
            </PostAction>
          </div>
        )
      )}
    </li>
  );
}
