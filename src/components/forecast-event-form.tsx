"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, X } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { addDays, todayInRiyadh } from "@/lib/riyadh-time";
import { FORECAST_EVENT_HINT, FORECAST_EVENT_KINDS, FORECAST_EVENT_LABEL, isForecastEventKind, type ForecastEventKind } from "@/lib/forecast/events";
import { ActionButton, Field, Input, Sheet, toast } from "./ui-client";
import { buttonClass, fieldClass } from "./ui-tokens";

/**
 * حدثٌ للتنبّؤ: إغلاقٌ أو نفادُ صنفٍ أو فعاليّة. يراه المحرّكُ الليلةَ القادمة،
 * ولا يمسّ شيئاً خارج صفحة التنبّؤ. وما كُتب يبقى إن فشل الحفظ.
 */
export function ForecastEventForm({ products }: { products: { id: string; name: string }[] }) {
  const router = useRouter();
  const today = todayInRiyadh();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ForecastEventKind>("EVENT");
  const [label, setLabel] = useState("");
  const [fromDay, setFromDay] = useState(today);
  const [toDay, setToDay] = useState(today);
  const [product, setProduct] = useState("");
  const [fromHour, setFromHour] = useState("");
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const labelError = label.trim().length < 2 ? "اكتب وصفاً قصيراً" : null;
  const rangeError = fromDay && toDay && fromDay > toDay ? "النهايةُ قبل البداية" : null;
  const productError = kind === "STOCKOUT" && !product ? "اختر الصنف الذي نفد" : null;

  async function save(): Promise<boolean> {
    setTried(true);
    setError(null);
    if (labelError || rangeError || productError || !fromDay || !toDay) return false;
    const r = await postJson<{ message?: string }>("/api/forecast-event", {
      action: "create", kind, label: label.trim(), fromDay, toDay,
      posProductId: kind === "STOCKOUT" ? product : null,
      fromHour: kind === "STOCKOUT" && fromHour !== "" ? Number(fromHour) : null,
    });
    if (!r.ok) {
      setError(r.error);
      return false;
    }
    toast({ tone: "ok", title: typeof r.data.message === "string" ? r.data.message : "سُجّل" });
    setOpen(false);
    setLabel(""); setTried(false); setProduct(""); setFromHour("");
    router.refresh();
    return true;
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("primary", "sm")}>
        <CalendarPlus className="h-4 w-4" strokeWidth={2} aria-hidden />
        سجّل حدثاً
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="حدثٌ يعرفه المقهى"
        description="إغلاقٌ أو نفادُ صنفٍ أو فعاليّة لا تعرفها الأرقام. يراه التنبّؤ الليلةَ القادمة، ولا يغيّر شيئاً خارج هذه الصفحة."
        footer={
          <>
            <button type="button" onClick={() => setOpen(false)} className={buttonClass("quiet")}>إلغاء</button>
            <ActionButton onAction={save} variant="primary">سجّل</ActionButton>
          </>
        }
      >
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
          <Field label="النوع" hint={FORECAST_EVENT_HINT[kind]}>
            {(p) => (
              <select id={p.id} aria-label="نوع الحدث" value={kind} onChange={(e) => setKind(isForecastEventKind(e.target.value) ? e.target.value : "EVENT")} className={fieldClass("md", false)}>
                {FORECAST_EVENT_KINDS.map((k) => <option key={k} value={k}>{FORECAST_EVENT_LABEL[k]}</option>)}
              </select>
            )}
          </Field>
          <Field label="الوصف" required error={tried ? labelError : null}>
            {({ invalid, ...p }) => <Input {...p} invalid={invalid} value={label} maxLength={120} placeholder="مثلاً: صيانة المكينة" onChange={(e) => setLabel(e.target.value)} />}
          </Field>
          <Field label="من يوم" required>
            {({ invalid, ...p }) => (
              <>
                <Input {...p} invalid={invalid} type="date" dir="ltr" value={fromDay} onChange={(e) => { setFromDay(e.target.value); if (toDay < e.target.value) setToDay(e.target.value); }} />
                <span className="mt-1.5 flex flex-wrap gap-1.5">
                  {[{ l: "أمس", v: addDays(today, -1) }, { l: "اليوم", v: today }, { l: "غداً", v: addDays(today, 1) }].map((c) => (
                    <button key={c.l} type="button" aria-pressed={fromDay === c.v} onClick={() => { setFromDay(c.v); setToDay(c.v); }}
                      className={`min-h-11 rounded-full border px-2.5 text-[11px] font-bold transition-colors sm:min-h-8 ${fromDay === c.v ? "border-accent-line bg-accent-soft text-accent" : "border-line bg-raised text-ink-soft hover:bg-hover"}`}>
                      {c.l}
                    </button>
                  ))}
                </span>
              </>
            )}
          </Field>
          <Field label="إلى يوم" required error={tried ? rangeError : null}>
            {({ invalid, ...p }) => <Input {...p} invalid={invalid} type="date" dir="ltr" value={toDay} onChange={(e) => setToDay(e.target.value)} />}
          </Field>
          {kind === "STOCKOUT" && (
            <>
              <Field label="الصنف" required error={tried ? productError : null}>
                {(p) => (
                  <select id={p.id} aria-label="الصنف الذي نفد" value={product} onChange={(e) => setProduct(e.target.value)} className={fieldClass("md", tried && !!productError)}>
                    <option value="">اختر…</option>
                    {products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                )}
              </Field>
              <Field label="نفد من الساعة" hint="اختياريّ — 0 إلى 23 بتوقيت الرياض.">
                {({ invalid, ...p }) => <Input {...p} invalid={invalid} type="number" inputMode="numeric" min={0} max={23} dir="ltr" value={fromHour} onChange={(e) => setFromHour(e.target.value)} />}
              </Field>
            </>
          )}
        </div>
        {error && <p role="alert" className="mt-4 rounded-lg border border-danger/25 bg-danger-bg px-3 py-2 text-xs font-bold text-danger">{error}</p>}
      </Sheet>
    </>
  );
}

/** إلغاءُ حدثٍ سُجّل خطأً — لا يُحذف، ويبقى في السجلّ. */
export function ForecastEventVoid({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  async function run(): Promise<boolean> {
    const r = await postJson("/api/forecast-event", { action: "void", id });
    if (!r.ok) {
      toast({ tone: "danger", title: r.error });
      return false;
    }
    toast({ tone: "ok", title: `أُلغي «${label}»` });
    router.refresh();
    return true;
  }
  return (
    <ActionButton onAction={run} variant="quiet" size="sm" aria-label={`ألغِ «${label}»`}>
      <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
      ألغِ
    </ActionButton>
  );
}
