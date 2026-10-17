"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui";

/**
 * سياسةُ مستندات المورّد — يكتبها الإنسان ولا تُشتقّ.
 *
 * ثلاثةُ أسئلةٍ عن المورّد لا يعرف النظام جوابَها ولن يعرفه من البيانات:
 *
 *   • **أيصدر فواتير ضريبية؟** غيابُ الفاتورة عندنا لا يعني أنّه لا
 *     يصدرها — قد تكون في الواتساب لم تُرفَع.
 *   • **أفواتيرُه ورقيّة؟** يعطي ورقةً باليد عند التسليم. فهي موجودةٌ
 *     حقّاً، ومطلبُها رفعُ الورقة لا عقدُ توريد.
 *   • **أيُطلَب منه عقد؟** مورّدٌ يُشترى منه مرّةً في السنة لا يُتصوَّر
 *     معه عقدُ توريد، والتنبيهُ عليه يُعلّم تجاهلَ التنبيهات.
 *
 * ولا يُحفَظ شيءٌ حتى يُضغَط «احفظ»: الصندوقُ الذي يحفظ بمجرّد لمسه
 * يجعل المستخدم يخشى أن يقرأ.
 */
export function SupplierPolicy({
  supplierId,
  initial,
  canEdit,
}: {
  supplierId: string;
  initial: {
    issuesInvoices: boolean;
    paperInvoices: boolean;
    contractRequired: boolean;
    contractOnFile: boolean;
  };
  canEdit: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const dirty =
    form.issuesInvoices !== initial.issuesInvoices
    || form.paperInvoices !== initial.paperInvoices
    || form.contractRequired !== initial.contractRequired
    || form.contractOnFile !== initial.contractOnFile;

  /* التناقضُ يُمنَع في الشاشة قبل أن يُردّ من الخادم */
  const conflict = form.paperInvoices && !form.issuesInvoices;

  async function save() {
    setBusy(true);
    setFailed(false);
    setMessage(null);
    const r = await postJson("/api/supplier-policy", { supplierId, ...form });
    setBusy(false);
    if (!r.ok) {
      setFailed(true);
      setMessage(r.error);
      return;
    }
    setMessage("تم حفظ السياسة.");
    router.refresh();
  }

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <div className="rounded-2xl border border-line bg-raised p-4 shadow-raised sm:p-5">
      <h3 className="text-sm font-bold">ما نطلبه من هذا المورّد</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        يحدّدها صاحب العمل ولا يستنتجها النظام، لأن غياب المستند عندنا لا يعني أنه غير موجود.
        وعلى هذه الخيارات يعتمد ما يظهر في «يحتاج قرارك».
      </p>

      <div className="mt-4 space-y-2.5">
        <Choice
          checked={form.issuesInvoices}
          disabled={!canEdit || busy}
          onChange={(v) => set({ issuesInvoices: v, ...(v ? {} : { paperInvoices: false }) })}
          label="يصدر فواتير ضريبية"
          hint="فاتورة تحمل رقمه الضريبي وبيانات الفاتورة الضريبية الكاملة، وبها وحدها تُخصم ضريبة المدخلات."
        />
        <Choice
          checked={form.paperInvoices}
          disabled={!canEdit || busy || !form.issuesInvoices}
          onChange={(v) => set({ paperInvoices: v })}
          label="فواتيره ورقية تُسلَّم باليد"
          hint={
            form.issuesInvoices
              ? "الفواتير موجودة فعلاً وإن لم تُرفع، لذلك لن نطالبك بعقد، بل برفع الفاتورة الورقية."
              : "لا يُختار هذا الخيار إلا للمورّد الذي يصدر فواتير: الفاتورة الورقية فاتورة موجودة لم تُرفع."
          }
        />
        <Choice
          checked={form.contractRequired}
          disabled={!canEdit || busy}
          onChange={(v) => set({ contractRequired: v })}
          label="يُطلب منه عقد توريد"
          hint="أوقفه للمورّد الذي تشتري منه مرة في السنة، حتى لا يظهر لك تنبيه لا تحتاج إلى فعل شيء بشأنه."
        />
        <Choice
          checked={form.contractOnFile}
          disabled={!canEdit || busy}
          onChange={(v) => set({ contractOnFile: v })}
          label="العقد موجود عندي"
          hint="وقّعته واحتفظت به، فيختفي التنبيه."
        />
      </div>

      {conflict && (
        <p className="mt-3 rounded-lg border border-warn/40 bg-warn-bg px-3 py-2 text-xs leading-relaxed text-warn">
          لا يمكن الجمع بينهما: «ورقية» تعني أن الفاتورة موجودة ولم تُرفع، و«لا يصدر فواتير» تعني
          أنها غير موجودة.
        </p>
      )}

      {canEdit && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            aria-busy={busy}
            type="button"
            onClick={save}
            disabled={busy || !dirty || conflict}
            className={buttonClass("primary", "sm")}
          >
            احفظ السياسة
          </button>
          {message && (
            <span className={`text-xs ${failed ? "text-danger" : "text-ok"}`}>{message}</span>
          )}
        </div>
      )}
    </div>
  );
}

function Choice({
  checked,
  disabled,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className={`flex gap-3 rounded-xl border border-line px-3 py-2.5 ${disabled ? "opacity-60" : "cursor-pointer hover:border-ink-soft"}`}>
      {/*
        الاسمُ على الصندوق نفسه: اللافتةُ تلفّه وتلفّ شرحَه معاً، فيقرأ
        قارئُ الشاشة الجملتين معاً أو لا يقرأ شيئاً — وقد قرأ «on».
      */}
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--ink)]"
      />
      <span className="min-w-0">
        <span className="block text-xs font-bold">{label}</span>
        <span className="block text-[11px] leading-relaxed text-muted">{hint}</span>
      </span>
    </label>
  );
}
