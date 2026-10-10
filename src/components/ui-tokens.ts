/**
 * أصنافُ الأزرار — في ملفٍّ لا يستورد شيئاً، فيقرؤه `ui.tsx` (للخادم)
 * و`ui-client.tsx` (للمتصفّح) معاً بلا استيرادٍ دائريّ بينهما.
 */
export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger" | "subtle";

export const BUTTON_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink shadow-xs hover:bg-accent-strong",
  /* حدُّه `--accent-line` لا `--line`: الأبيضُ على بطاقةٍ بيضاء بحدٍّ ‎1.3:1‎ كان يُعرف بنصّه وحده */
  secondary: "border border-accent-line bg-raised text-ink shadow-xs hover:border-line-input hover:bg-hover",
  quiet: "text-ink-soft hover:bg-hover hover:text-ink",
  danger: "border border-danger/40 bg-raised text-danger hover:bg-danger-bg",
  subtle: "bg-accent-soft text-accent hover:brightness-95",
};

/**
 * صنفُ الحقل — مقاسٌ واحد وحدٌّ واحد لكلّ `input` و`select` و`textarea`.
 * كان كلُّ مكوّنٍ يكتب `const field = "…"` بارتفاعٍ وخطٍّ مختلفين. و`invalid`
 * يلوّن الحدّ؛ والرسالةُ والربطُ بها في `Field` (`ui-client.tsx`).
 */
export function fieldClass(size: "sm" | "md" = "md", invalid = false) {
  const pad = size === "sm" ? "min-h-11 px-2.5 text-xs sm:min-h-9" : "min-h-11 px-3 text-sm sm:min-h-10";
  return `w-full min-w-0 rounded-lg border bg-raised text-ink placeholder:text-muted disabled:cursor-not-allowed disabled:bg-sunken disabled:text-muted ${pad} ${
    invalid ? "border-danger" : "border-line-input"
  }`;
}

export function buttonClass(variant: ButtonVariant = "secondary", size: "sm" | "md" | "lg" = "md") {
  /*
    ارتفاعُ اللمس ٤٤ بكسلاً على الجوّال — أحمد يضغطها بإبهامه عند الكاشير.
    وعلى الحاسوب تعود مضغوطةً بمقاس الأدوات.
  */
  const pad =
    size === "sm" ? "min-h-11 px-3 text-xs sm:min-h-8"
    : size === "lg" ? "min-h-12 px-5 text-[15px]"
    : "min-h-11 px-4 text-sm sm:min-h-10";
  /*
    `btn` يملك الحركة كلَّها (`globals.css`): الضغطُ، والانتظارُ في مكانه
    (`aria-busy`)، وعلامةُ النجاح (`data-done`). والمعطَّلُ يبقى تحت الفأرة
    كي يُقرأ سببُه في `title` — كان `pointer-events: none` يُسكته.
  */
  return `btn inline-flex shrink-0 select-none items-center justify-center gap-1.5 rounded-lg font-bold disabled:cursor-not-allowed disabled:opacity-50 ${pad} ${BUTTON_CLASS[variant]}`;
}
