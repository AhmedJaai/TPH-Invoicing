"use client";

import { useState } from "react";
import { buttonClass, type ButtonVariant } from "./ui";

/**
 * عناصر تحتاج تفاعلاً.
 * ما لا يحتاجه في `ui.tsx` كي يبقى على الخادم بلا حزمة.
 */

/**
 * فعلٌ لا رجعة فيه يُؤكَّد بإقرار، لا بنقرتين.
 *
 * «هل أنت متأكّد؟» سؤالٌ يُجاب بنعم آلياً بعد ثالث مرّة. أمّا أن يقرأ
 * المستخدم ماذا يعني الفعل ثمّ يعلن أنّه فهمه، فذلك يوقفه لحظةً كافية.
 */
export function ConfirmAction({
  label,
  title,
  consequence,
  acknowledgement,
  confirmLabel,
  variant = "danger",
  tone = "danger",
  size = "sm",
  block = false,
  onConfirm,
  disabled,
}: {
  label: string;
  title: string;
  /** ماذا يترتّب على الفعل — بصراحة لا بتلميح. */
  consequence: string;
  /** ما يقرّه المستخدم قبل أن يُفتح الزرّ. */
  acknowledgement: string;
  confirmLabel: string;
  variant?: ButtonVariant;
  /**
   * حِدّة اللوح: `danger` لما لا رجعة فيه، و`warn` لما يُراجَع ويُفتح
   * ثانيةً — كإقفال شهرٍ يمكن إعادة فتحه. وصبغُ كل تأكيدٍ بالأحمر
   * يُبطل معنى الأحمر حين يلزم فعلاً.
   */
  tone?: "danger" | "warn";
  /** حجم الزرّ الذي يفتح اللوح — الفعل الرئيسيّ للصفحة يستحقّ `md`. */
  size?: "sm" | "md";
  /** يملأ الزرّ عرض حاويته — للفعل الرئيسيّ في ذيل بطاقة. */
  block?: boolean;
  /** يُرجع `false` إن فشل — فيبقى اللوح مفتوحاً ولا يُعاد الإقرار. */
  onConfirm: () => Promise<void | boolean> | void | boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);

  const skin =
    tone === "warn"
      ? { box: "border-warn/40 bg-warn-bg", title: "text-warn", confirm: "primary" as ButtonVariant }
      : { box: "border-danger/40 bg-danger-bg", title: "text-danger", confirm: "danger" as ButtonVariant };

  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={`${buttonClass(variant, size)} ${block ? "w-full" : ""}`}
      >
        {label}
      </button>
    );
  }

  return (
    <div className={`rounded-2xl border p-4 ${skin.box}`}>
      <p className={`text-sm font-bold ${skin.title}`}>{title}</p>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">{consequence}</p>

      <label className="mt-3 flex items-start gap-2 text-xs leading-relaxed">
        <input
          type="checkbox"
          checked={understood}
          onChange={(e) => setUnderstood(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-current"
        />
        <span>{acknowledgement}</span>
      </label>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!understood || busy}
          onClick={async () => {
            setBusy(true);
            let ok = true;
            try {
              ok = (await onConfirm()) !== false;
            } catch {
              ok = false;
            } finally {
              setBusy(false);
              /* اللوح يُغلق عند النجاح وحده — كان يُغلق بعد الفشل فيُعاد الإقرار كلُّه */
              if (ok) {
                setOpen(false);
                setUnderstood(false);
              }
            }
          }}
          className={buttonClass(skin.confirm, "sm")}
        >
          {busy ? "يُنفَّذ…" : confirmLabel}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setUnderstood(false); }}
          className={buttonClass("quiet", "sm")}
        >
          تراجع
        </button>
      </div>
    </div>
  );
}
