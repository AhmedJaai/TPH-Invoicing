"use client";

import { useFormStatus } from "react-dom";

/**
 * زرُّ إرسالٍ لنموذجٍ فعلُه في الخادم — ينتظر في مكانه.
 *
 * بين الضغطة وتحويل جوجل ثانيةٌ أو ثانيتان على شبكة الجوّال لا يتغيّر فيهما شيء،
 * فيُضغط ثانيةً. `useFormStatus` يقول إنّ النموذج أُرسل: الزرُّ يحمل `aria-busy`
 * (دوّارةُ `buttonClass` بعرضه نفسه) ولا يقبل ضغطةً ثانية.
 */
export function SubmitButton({
  children,
  className,
  label,
  title,
}: {
  children: React.ReactNode;
  className: string;
  /** اسمٌ يُقرأ حين يكون الزرُّ رمزاً بلا نصّ. */
  label?: string;
  title?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      aria-busy={pending}
      aria-disabled={pending}
      aria-label={label}
      title={title}
      /* زرٌّ ليس من `buttonClass` (رمزُ الخروج) يبهت ريثما يُرسَل — فلا يبقى بلا أثر */
      className={`${className} aria-busy:cursor-progress aria-busy:opacity-60`}
      onClick={(e) => { if (pending) e.preventDefault(); }}
    >
      {children}
    </button>
  );
}
