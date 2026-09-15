"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui";

export interface BankRuleRow {
  id: string;
  pattern: string;
  categoryLabel: string;
  supplier: string | null;
  note: string | null;
}

/** قواعد التصنيف كما حُفظت — تُرى، وتُحذف بخطوتين. */
export function BankRules({ rows, canEdit }: { rows: BankRuleRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (rows.length === 0) {
    return <p className="text-sm text-muted">لا قواعد بعد — تُنشأ من «صنّفها» عند استيراد كشف البنك.</p>;
  }

  return (
    <div>
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-raised shadow-raised">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
            <span className="min-w-0">
              <bdi className="block truncate font-mono text-sm" dir="auto">{r.pattern}</bdi>
              <span className="block truncate text-[11px] text-muted">
                {r.categoryLabel}{r.supplier ? ` · ${r.supplier}` : ""}{r.note ? ` · ${r.note}` : ""}
              </span>
            </span>
            {canEdit && (asking === r.id ? (
              <span className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={busy}
                  className={buttonClass("danger", "sm")}
                  onClick={async () => {
                    setBusy(true);
                    const res = await postJson("/api/bank-rule", { action: "delete", id: r.id });
                    setBusy(false);
                    setAsking(null);
                    setMessage(res.ok ? { ok: true, text: String((res.data as { message?: string }).message ?? "حُذفت") } : { ok: false, text: res.error });
                    if (res.ok) router.refresh();
                  }}
                >
                  {busy ? "يحذف…" : "نعم، احذفها"}
                </button>
                <button type="button" className={buttonClass("quiet", "sm")} onClick={() => setAsking(null)}>إلغاء</button>
              </span>
            ) : (
              <button type="button" className={buttonClass("quiet", "sm")} onClick={() => setAsking(r.id)}>احذفها</button>
            ))}
          </li>
        ))}
      </ul>
      {message && (
        <p role="status" className={`mt-2 text-xs ${message.ok ? "text-ok" : "text-danger"}`}>{message.text}</p>
      )}
    </div>
  );
}
