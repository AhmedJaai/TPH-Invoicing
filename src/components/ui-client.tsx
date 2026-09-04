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
  onConfirm: () => Promise<void> | void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={buttonClass(variant, "sm")}
      >
        {label}
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-danger/40 bg-danger-bg p-4">
      <p className="text-sm font-bold text-danger">{title}</p>
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
            try {
              await onConfirm();
            } finally {
              setBusy(false);
              setOpen(false);
              setUnderstood(false);
            }
          }}
          className={buttonClass("danger", "sm")}
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

/**
 * شريط أفعال ملتصق بأسفل الشاشة على الجوّال.
 *
 * الفعل الرئيسيّ في ذيل صفحة طويلة لا يُبلَغ إلّا بعد تمرير كامل. وعلى
 * الجوّال يبقى في متناول الإبهام. ويرتفع فوق شريط التنقّل لا تحته.
 */
export function StickyActions({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 border-t border-line bg-surface/95 px-4 py-2.5 backdrop-blur-md sm:hidden">
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

/**
 * حالة عمل جارٍ بمراحل مسمّاة.
 *
 * «جارٍ…» لا تقول شيئاً، والنسبة المئوية المخترَعة تكذب. أمّا اسم
 * المرحلة الحالية فصادقٌ ومفيد: يعرف المستخدم أين وصل العمل.
 */
export function Progress({
  steps,
  current,
}: {
  steps: readonly string[];
  current: number;
}) {
  return (
    <div aria-live="polite">
      <div className="flex gap-1">
        {steps.map((s, i) => (
          <span
            key={s}
            className={`h-1 flex-1 rounded-full ${
              i < current ? "bg-ink" : i === current ? "upload-bar bg-ink/50" : "bg-sunken"
            }`}
          />
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">
        {steps[current] ?? steps[steps.length - 1]}
        {current < steps.length && <span className="nums"> · {current + 1}/{steps.length}</span>}
      </p>
    </div>
  );
}
