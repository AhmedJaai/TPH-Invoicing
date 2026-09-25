"use client";

import { Printer } from "lucide-react";
import { buttonClass, type ButtonVariant } from "./ui-tokens";

/**
 * «اطبع أو احفظ PDF» — حوارُ الطباعة في المتصفّح يحفظ PDF كذلك، فلا
 * يُبنى مولّدُ ملفّاتٍ على الخادم لما يفعله المتصفّح. وما عليه `.no-print`
 * يسقط من الورقة (`globals.css`).
 */
export function PrintButton({ label = "اطبع أو احفظ PDF", variant = "primary" }: { label?: string; variant?: ButtonVariant }) {
  return (
    <button type="button" onClick={() => window.print()} className={buttonClass(variant)}>
      <Printer className="h-4 w-4" strokeWidth={2} aria-hidden />
      {label}
    </button>
  );
}
