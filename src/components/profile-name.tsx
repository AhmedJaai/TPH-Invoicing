"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/http-client";
import { ReadySubmit, toast } from "./ui-client";

/** «اسمك كما يظهر» — يُكتب مرّةً فتقول التحيّةُ «صباح الخير، أحمد» لا «Ahmed». */
export function ProfileName({ current }: { current: string | null }) {
  const router = useRouter();
  const [name, setName] = useState(current ?? "");
  const [busy, setBusy] = useState(false);
  const dirty = name.trim() !== (current ?? "").trim() && name.trim().length >= 2;

  async function save() {
    if (!dirty || busy) return;
    setBusy(true);
    const r = await postJson<{ message?: string }>("/api/profile-name", { name: name.trim() });
    setBusy(false);
    if (!r.ok) { toast({ tone: "danger", title: "لم يُحفظ الاسم", body: r.error }); return; }
    toast({ tone: "ok", title: r.data.message ?? "حُفظ اسمك" });
    router.refresh();
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="mt-4 flex flex-wrap items-end gap-2 border-t border-line-soft pt-4">
      <label className="min-w-0 flex-1 basis-56 text-xs font-bold text-ink-soft">
        اسمك كما يظهر في التحية وسجل التدقيق
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} disabled={busy} placeholder="مثلاً: أحمد"
          className="mt-1 block min-h-11 w-full rounded-lg border border-line-input bg-raised px-3 text-sm font-normal" />
      </label>
      <ReadySubmit ready={dirty} busy={busy} variant="secondary" missing={name.trim().length < 2 ? "اكتب اسماً من حرفين على الأقل." : "لم يتغيّر الاسم."}>احفظ</ReadySubmit>
    </form>
  );
}
