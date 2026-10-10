"use client";

import { Copy } from "lucide-react";
import { toast } from "./ui-client";

/**
 * قيمةٌ تُنسَخ بضغطة — مبلغٌ بصيغة البنك (1234.56) أو رقمُ حساب.
 *
 * نسخُ مبلغٍ إلى تطبيق البنك كان تحديداً دقيقاً لنصٍّ `ltr` داخل سطرٍ عربيّ،
 * وكسرُه في عنصرٍ منفصل. فالظاهرُ يبقى كما يُقرأ، والمنسوخُ `value` كما يقبله
 * حقلُ البنك: بلا فواصل آلاف ولا «ر.س».
 */
export function CopyValue({ value, label, children, className = "" }: {
  /** ما يُنسَخ بنصّه. */
  value: string;
  /** ما يُقال لقارئ الشاشة وفي الإشعار: «المبلغ»، «الحساب». */
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      toast({ tone: "ok", title: `نُسخ ${label}`, body: value, duration: 2500 });
    } catch {
      toast({ tone: "warn", title: "تعذّر النسخ", body: "المتصفّح منعه — حدّد النصَّ يدويّاً." });
    }
  }
  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={`انسخ ${label}`}
      data-tip={`انسخ ${label}`}
      className={`group inline-flex max-w-full items-center gap-1 rounded-md text-start hover:text-accent ${className}`}
    >
      <span className="min-w-0 truncate">{children}</span>
      <Copy className="h-3 w-3 shrink-0 opacity-50 group-hover:opacity-100" strokeWidth={2} aria-hidden />
    </button>
  );
}
