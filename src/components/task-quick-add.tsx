"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { addDays, todayInRiyadh } from "@/lib/riyadh-time";
import { ActionButton, toast } from "./ui-client";
import { fieldClass } from "./ui-tokens";

/**
 * إضافةٌ سريعة: اكتب واضغط Enter. الموعدُ اختيارٌ بنقرة (اليوم · غداً)، والتفصيلُ (تذكير،
 * تكرار، ملاحظة) من «مهمّة جديدة». الحقلُ يبقى مفتوحاً ومركَّزاً لإضافة التالية.
 */
export function TaskQuickAdd() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState<"none" | "today" | "tomorrow">("none");
  const [error, setError] = useState<string | null>(null);

  async function add(): Promise<boolean> {
    setError(null);
    if (title.trim().length < 2) {
      setError("اكتب عنوان المهمّة");
      input.current?.focus();
      return false;
    }
    const today = todayInRiyadh();
    const r = await postJson<{ message?: string }>("/api/task", {
      action: "create", title: title.trim(), priority: "NORMAL", repeat: "NONE",
      dueOn: due === "today" ? today : due === "tomorrow" ? addDays(today, 1) : null,
    });
    if (!r.ok) {
      setError(r.error);
      return false;
    }
    toast({ tone: "ok", title: typeof r.data.message === "string" ? r.data.message : "أُضيفت" });
    setTitle("");
    router.refresh();
    input.current?.focus();
    return true;
  }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); void add(); }}
      className="rounded-xl border border-line bg-raised p-3 shadow-raised"
      aria-label="إضافة مهمّة سريعة"
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          value={title}
          maxLength={160}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="مهمّة جديدة… مثلاً: اتصل بمورّد الحليب"
          aria-label="عنوان المهمّة"
          aria-invalid={error ? true : undefined}
          className={`${fieldClass("md", !!error)} min-w-0 flex-1 basis-56`}
        />
        <span className="flex items-center gap-1.5" role="group" aria-label="الموعد">
          {([["none", "بلا موعد"], ["today", "اليوم"], ["tomorrow", "غداً"]] as const).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={due === k}
              onClick={() => setDue(k)}
              className={`min-h-11 rounded-full border px-3 text-[12px] font-bold transition-colors sm:min-h-9 ${
                due === k ? "border-accent-line bg-accent-soft text-accent" : "border-line bg-raised text-ink-soft hover:bg-hover"
              }`}
            >
              {label}
            </button>
          ))}
        </span>
        <ActionButton onAction={add} variant="primary">
          <Plus className="h-4 w-4" strokeWidth={2} aria-hidden />أضف
        </ActionButton>
      </div>
      {error && <p role="alert" className="mt-2 text-xs font-bold text-danger">{error}</p>}
    </form>
  );
}
