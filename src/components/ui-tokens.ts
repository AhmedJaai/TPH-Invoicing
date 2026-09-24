/**
 * أصنافُ الأزرار — في ملفٍّ لا يستورد شيئاً، فيقرؤه `ui.tsx` (للخادم)
 * و`ui-client.tsx` (للمتصفّح) معاً بلا استيرادٍ دائريّ بينهما.
 */
export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger" | "subtle";

export const BUTTON_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink shadow-xs hover:bg-accent-strong",
  secondary: "border border-line bg-raised text-ink shadow-xs hover:border-line-input hover:bg-hover",
  quiet: "text-ink-soft hover:bg-hover hover:text-ink",
  danger: "border border-danger/40 bg-raised text-danger hover:bg-danger-bg",
  subtle: "bg-accent-soft text-accent hover:brightness-95",
};

export function buttonClass(variant: ButtonVariant = "secondary", size: "sm" | "md" | "lg" = "md") {
  /*
    ارتفاعُ اللمس ٤٤ بكسلاً على الجوّال — أحمد يضغطها بإبهامه عند الكاشير.
    وعلى الحاسوب تعود مضغوطةً بمقاس الأدوات.
  */
  const pad =
    size === "sm" ? "min-h-11 px-3 text-xs sm:min-h-8"
    : size === "lg" ? "min-h-12 px-5 text-[15px]"
    : "min-h-11 px-4 text-sm sm:min-h-10";
  return `inline-flex shrink-0 select-none items-center justify-center gap-1.5 rounded-lg font-bold transition-[background-color,border-color,color,box-shadow,filter] duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 ${pad} ${BUTTON_CLASS[variant]}`;
}
