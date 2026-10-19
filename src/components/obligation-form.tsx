"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { postJson } from "@/lib/http-client";
import {
  DEFAULT_REMIND_DAYS, MAX_REMIND_DAYS, OBLIGATION_KINDS, OBLIGATION_KIND_LABEL, isRealDay, type Obligation, type ObligationKind,
} from "@/lib/obligations";
import { ActionButton, Field, Input, Sheet, toast } from "./ui-client";
import { buttonClass, fieldClass } from "./ui-tokens";

/**
 * نموذجُ الوثيقة — يُضيف واحدةً أو يعدّل قائمة (ومنه التجديد: تاريخُ انتهاءٍ جديد).
 *
 * يُفتح في لوحٍ كي لا يطول الجدول. والخطأُ بجانب حقله، والخادمُ يعيد الفحص.
 * وما كُتب يبقى في اللوح إن فشل الحفظ.
 */
export function ObligationForm({ existing }: { existing?: Obligation }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ObligationKind>(existing?.kind ?? "MUNICIPAL_LICENCE");
  const [title, setTitle] = useState(existing?.title ?? "");
  const [issuer, setIssuer] = useState(existing?.issuer ?? "");
  const [reference, setReference] = useState(existing?.reference ?? "");
  const [holder, setHolder] = useState(existing?.holder ?? "");
  const [expiresOn, setExpiresOn] = useState(existing?.expiresOn ?? "");
  const [remindDays, setRemindDays] = useState(String(existing?.remindDays ?? DEFAULT_REMIND_DAYS));
  const [note, setNote] = useState(existing?.note ?? "");
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remind = Number(remindDays);
  const titleError = title.trim().length < 2 ? "اكتب اسم الوثيقة" : null;
  const dateError = !isRealDay(expiresOn) ? "اختر تاريخ الانتهاء" : null;
  const remindError = !Number.isInteger(remind) || remind < 1 || remind > MAX_REMIND_DAYS ? `من يوم واحد إلى ${MAX_REMIND_DAYS} يوماً` : null;

  async function save(): Promise<boolean> {
    setTried(true);
    setError(null);
    if (titleError || dateError || remindError) return false;
    const r = await postJson<{ message?: string }>("/api/obligation", {
      action: existing ? "update" : "create",
      ...(existing ? { id: existing.id } : {}),
      kind, title: title.trim(), issuer, reference, holder, expiresOn, remindDays: remind, note,
    });
    if (!r.ok) {
      setError(r.error);
      return false;
    }
    toast({ tone: "ok", title: typeof r.data.message === "string" ? r.data.message : "حُفظ" });
    setOpen(false);
    if (!existing) {
      setTitle(""); setIssuer(""); setReference(""); setHolder(""); setExpiresOn(""); setNote(""); setTried(false);
    }
    router.refresh();
    return true;
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`${buttonClass(existing ? "quiet" : "primary", existing ? "sm" : "md")} relative`}>
        {existing ? <Pencil className="h-3.5 w-3.5" strokeWidth={2} aria-hidden /> : <Plus className="h-4 w-4" strokeWidth={2} aria-hidden />}
        {existing ? "تعديل أو تجديد" : "إضافة وثيقة"}
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={existing ? `تعديل «${existing.title}»` : "وثيقة جديدة"}
        description={existing ? "للتجديد اكتب تاريخ الانتهاء الجديد. يبقى التاريخ القديم محفوظاً في سجل التدقيق." : "كل وثيقة لها تاريخ انتهاء وتترتب على فواته غرامة: رخصة، أو شهادة، أو إقامة، أو عقد."}
        footer={
          <>
            <button type="button" onClick={() => setOpen(false)} className={buttonClass("quiet")}>إلغاء</button>
            <ActionButton onAction={save} variant="primary">احفظ</ActionButton>
          </>
        }
      >
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
          <Field label="النوع" required>
            {(p) => (
              <select id={p.id} aria-label="نوع الوثيقة" value={kind} onChange={(e) => setKind(OBLIGATION_KINDS.find((k) => k === e.target.value) ?? "OTHER")} className={fieldClass("md", false)}>
                {OBLIGATION_KINDS.map((k) => <option key={k} value={k}>{OBLIGATION_KIND_LABEL[k]}</option>)}
              </select>
            )}
          </Field>
          <Field label="اسم الوثيقة" required error={tried ? titleError : null} hint="اكتبه كما تعرفه، مثل: «رخصة البلدية – النسيم».">
            {({ invalid, ...p }) => <Input {...p} invalid={invalid} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
          <Field label="تاريخ الانتهاء" required error={tried ? dateError : null} hint="بالتاريخ الميلادي.">
            {({ invalid, ...p }) => <Input {...p} invalid={invalid} type="date" dir="ltr" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />}
          </Field>
          <Field label="ذكّرني قبلها بكم يوم؟" required error={tried ? remindError : null} hint="مثلاً: ٣٠ يوماً للرخص و٩٠ يوماً لعقد الإيجار.">
            {({ invalid, ...p }) => <Input {...p} invalid={invalid} type="text" inputMode="numeric" dir="ltr" className="nums" value={remindDays} onChange={(e) => setRemindDays(e.target.value.replace(/[^\d]/g, ""))} />}
          </Field>
          <Field label="الجهة المصدرة">
            {({ invalid, ...p }) => <Input {...p} invalid={invalid} value={issuer} maxLength={120} onChange={(e) => setIssuer(e.target.value)} />}
          </Field>
          <Field label="رقم الوثيقة">
            {({ invalid, ...p }) => <Input {...p} invalid={invalid} dir="ltr" value={reference} maxLength={80} onChange={(e) => setReference(e.target.value)} />}
          </Field>
          <Field label="صاحب الوثيقة" hint="اسم الموظف في الإقامة والشهادة الصحية.">
            {({ invalid, ...p }) => <Input {...p} invalid={invalid} value={holder} maxLength={120} onChange={(e) => setHolder(e.target.value)} />}
          </Field>
          <Field label="ملاحظة">
            {({ invalid, ...p }) => <Input {...p} invalid={invalid} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />}
          </Field>
        </div>
        {error && <p role="alert" className="mt-4 rounded-lg border border-danger/25 bg-danger-bg px-3 py-2 text-xs font-bold text-danger">{error}</p>}
      </Sheet>
    </>
  );
}
