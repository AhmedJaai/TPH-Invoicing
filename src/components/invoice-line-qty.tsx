"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PenLine } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { formatRiyalsDisplay } from "@/lib/money";
import { parseLineQuantity } from "@/lib/line-pricing";
import { buttonClass } from "./ui-tokens";
import { toast } from "./ui-client";

/**
 * كمّيّةُ البند — تُصحَّح في مكانها حين قرأها النموذج خطأً (٥ كيلو قُرئت «١ × ٧٢٥»).
 *
 * المجموعُ لا يُكتب هنا: هو ما دُفع. والخادمُ يشتقّ سعرَ الوحدة منه (`correctInvoiceLine`)؛
 * وما يُعرض قبل الحفظ عونٌ لا حكم.
 */
export function InvoiceLineQty({ lineId, qty, lineTotalMinor, canEdit }: {
  lineId: string;
  /** كما خُزّنت — `null` «غير مقروءة» */
  qty: string | null;
  lineTotalMinor: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const shown = qty === null ? null : trim(qty);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(shown ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className={shown === null ? "text-muted" : "nums"}>{shown ?? "غير مقروءة"}</span>
        {canEdit && (
          <button
            type="button"
            onClick={() => { setValue(shown ?? ""); setError(null); setOpen(true); }}
            className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted hover:text-ink sm:min-h-7 sm:min-w-7"
            aria-label="صحّح الكمية"
            title="صحّح الكمية"
          >
            <PenLine className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          </button>
        )}
      </span>
    );
  }

  const parsed = value.trim() === "" ? null : parseLineQuantity(value);
  const unreadable = value.trim() !== "" && parsed === null;
  const same = (parsed === null ? null : Number(parsed)) === (shown === null ? null : Number(shown));

  async function save() {
    setBusy(true);
    setError(null);
    const r = await postJson<{ changed: boolean; qty: string | null; unitPriceMinor: number }>(
      "/api/invoice-line", { lineId, quantity: value.trim() === "" ? null : value },
    );
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setOpen(false);
    toast({
      tone: "ok",
      title: "صُحّحت الكمية",
      body: r.data.qty === null
        ? "صارت «غير معروفة»، فلا يدخل البند في مقارنة الأسعار."
        : `من ${shown ?? "غير مقروءة"} إلى ${trim(r.data.qty)}، وصار سعر الوحدة ${formatRiyalsDisplay(r.data.unitPriceMinor)}. مجموع البند لم يتغيّر.`,
      duration: 10_000,
      undo: {
        run: async () => {
          const u = await postJson("/api/invoice-line", { lineId, quantity: qty });
          if (u.ok) router.refresh();
          return u.ok;
        },
      },
    });
    router.refresh();
  }

  return (
    <span className="relative inline-flex flex-col items-end gap-1">
      <span className="inline-flex items-center gap-1.5">
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy && !unreadable && !same) save();
            if (e.key === "Escape") setOpen(false);
          }}
          dir="ltr"
          inputMode="decimal"
          aria-label="الكمية الصحيحة"
          aria-invalid={unreadable || undefined}
          className={`nums min-h-11 w-20 rounded-lg border bg-raised px-2 text-sm sm:min-h-8 ${unreadable ? "border-danger" : "border-line-input"}`}
        />
        <button type="button" onClick={save} disabled={busy || unreadable || same} aria-busy={busy} className={buttonClass("primary", "sm")}>
          احفظ
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={busy} className={buttonClass("quiet", "sm")}>
          إلغاء
        </button>
      </span>
      <span aria-live="polite" className={`text-[11px] ${error || unreadable ? "text-danger" : "text-muted"}`}>
        {error ?? (unreadable
          ? "اكتبها رقماً مثل 5 أو 2.5"
          : parsed === null
            ? "فارغة: تُحفظ «غير معروفة»"
            : `سعر الوحدة سيصير ${formatRiyalsDisplay(Math.round(lineTotalMinor / Number(parsed)))}`)}
      </span>
    </span>
  );
}

function trim(qty: string): string {
  return qty.includes(".") ? qty.replace(/\.?0+$/, "") : qty;
}
