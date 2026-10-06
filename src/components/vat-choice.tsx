"use client";

/**
 * يضمّ حركةَ بنكٍ إلى إقرار الضريبة أو يُخرجها — مربّعٌ في صفّها، وزرٌّ لمجموعة.
 *
 * يرسل المعرّفات والقرار وحدهما؛ والخادمُ يعيد الحساب ويُرسَم من جديد (`router.refresh`).
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { postJson } from "@/lib/http-client";
import { ActionButton, toast } from "./ui-client";

type Kind = "tx" | "invoice";

async function send(ids: readonly string[], included: boolean | null, kind: Kind = "tx"): Promise<boolean> {
  const res = await postJson("/api/vat-choice", { kind, ids, included });
  if (!res.ok) {
    toast({ title: "لم يُحفَظ الاختيار", body: res.error, tone: "danger" });
    return false;
  }
  return true;
}

export function VatTxToggle({
  id,
  included,
  locked,
  label,
}: {
  id: string;
  included: boolean;
  /** سببُ المنع إن كانت لا تُضمّ — فاتورتُها محسوبة. */
  locked?: string;
  label: string;
}) {
  const router = useRouter();
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [pending, start] = useTransition();
  const checked = optimistic ?? included;

  async function toggle() {
    if (locked || pending) return;
    const next = !checked;
    setOptimistic(next);
    const ok = await send([id], next);
    if (!ok) { setOptimistic(null); return; }
    start(() => { router.refresh(); });
  }

  return (
    <label
      title={locked}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center sm:min-h-0 sm:min-w-0 ${locked ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
    >
      <input
        type="checkbox"
        className="h-4 w-4 accent-[var(--accent)]"
        checked={checked}
        disabled={Boolean(locked)}
        aria-busy={pending}
        aria-label={locked ? `${label} — ${locked}` : `احسب ${label} في الإقرار`}
        onChange={toggle}
      />
    </label>
  );
}

/** فعلٌ على مجموعة: «ضمّ كلّ الكهرباء» أو «أعد الكلّ إلى الأصل». */
export function VatBulk({
  ids,
  included,
  children,
  variant = "secondary",
  kind = "tx",
}: {
  ids: readonly string[];
  included: boolean | null;
  children: React.ReactNode;
  variant?: "secondary" | "quiet" | "subtle";
  kind?: Kind;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  return (
    <ActionButton
      size="sm"
      variant={variant}
      disabled={ids.length === 0}
      reason="لا حركةَ يتغيّر اختيارُها"
      onAction={async () => {
        const ok = await send(ids, included, kind);
        if (ok) start(() => { router.refresh(); });
        return ok;
      }}
    >
      {children}
    </ActionButton>
  );
}
