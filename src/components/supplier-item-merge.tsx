"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Merge } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui-tokens";
import { toast } from "./ui-client";

/**
 * «هو نفسه…» — صيغةٌ أخرى لصنفٍ عند المورّد نفسه.
 *
 * الأقربُ اسماً مقدَّمٌ ومعلَّم (`similarItems`)، والاختيارُ إقرار: تُنقل بنودُ هذه
 * الصيغة إلى الأصل، ويُكتب بالأصل كلُّ بندٍ يأتي بها بعد اليوم.
 * وهو فوق طبقة رابط الصفّ (`relative z-10`) فلا تفتح الضغطةُ الفاتورة.
 */
export function SupplierItemMerge({ supplierId, item, name, options }: {
  supplierId: string;
  item: string;
  name: string;
  /** أصنافُ المورّد الأخرى — المقترَحُ أوّلاً */
  options: { key: string; name: string; suggested: boolean }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [into, setInto] = useState(options.find((o) => o.suggested)?.key ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (options.length === 0) return null;
  const target = options.find((o) => o.key === into);

  async function merge() {
    if (!target) return;
    setBusy(true);
    setError(null);
    const r = await postJson<{ message: string }>("/api/supplier-item-merge", { supplierId, from: item, into });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    toast({ tone: "ok", title: `«${name}» صار «${target.name}»`, body: r.data.message });
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative z-10 mt-1 inline-flex min-h-8 items-center gap-1 text-[11px] font-medium text-accent hover:underline"
      >
        <Merge className="h-3 w-3" aria-hidden />
        {options.some((o) => o.suggested) ? "يشبه صنفاً آخر — هو نفسه؟" : "هو نفسه صنفٌ آخر؟"}
      </button>
    );
  }

  return (
    <div className="relative z-10 mt-2 rounded-lg border border-line bg-sunken/60 p-2.5">
      <label className="block text-[11px] text-muted">
        «{name}» هو نفسه:
        <select
          value={into}
          onChange={(e) => setInto(e.target.value)}
          disabled={busy}
          className="mt-1 block min-h-11 w-full rounded-lg border border-line-input bg-raised px-2 text-xs sm:min-h-9"
        >
          <option value="">— اختر —</option>
          {options.map((o) => (
            <option key={o.key} value={o.key}>{o.name}{o.suggested ? " · مقترَح" : ""}</option>
          ))}
        </select>
      </label>
      {target && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-soft">
          تُنقل بنودُ «{name}» إلى «{target.name}» ويُجمع تاريخُ سعرهما، ويُكتب بـ«{target.name}» كلُّ بندٍ يأتي بهذا الاسم بعد اليوم.
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={merge} disabled={busy || !target} aria-busy={busy} className={buttonClass("primary", "sm")}>
          {busy ? "يُدمج…" : "نعم، صنفٌ واحد"}
        </button>
        <button type="button" onClick={() => { setOpen(false); setError(null); }} disabled={busy} className={buttonClass("quiet", "sm")}>
          ألغِ
        </button>
      </div>
      {error && <p role="alert" className="mt-1.5 text-xs text-danger">{error}</p>}
    </div>
  );
}
