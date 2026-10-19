"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, FileText, ScanEye, X } from "lucide-react";
import { postJson, readResponse } from "@/lib/http-client";
import { queueCapture, tagCapture } from "@/lib/capture-queue";
import type { ClarityVerdict } from "@/lib/capture-clarity";
import { timeAgo } from "@/lib/arabic";
import { buttonClass } from "./ui-tokens";
import { toast } from "./ui-client";

export interface TeamCaptureItem {
  id: string;
  sender: string;
  createdAt: string;
  note: string | null;
  mimeType: string;
  verdict: ClarityVerdict | null;
  readError: string | null;
}

/** أسبابٌ تتكرّر — ضغطةٌ بدل كتابة. والنصُّ يصل الباريستا كما هو. */
const REASONS = [
  "الصورة غير واضحة، صوّرها مرة أخرى",
  "ليست فاتورة",
  "الفاتورة ناقصة صفحة",
  "وصلت من قبل",
];

/**
 * صورُ الفريق المنتظِرة — في شاشة الرفع، فوق ما يُقرأ.
 *
 * «راجِعها» يضعها في القارئ أعلى الصفحة كأيّ ملفٍّ رُفع من هنا (قراءتُها محفوظةٌ
 * منذ وصلت فلا تُدفع ثانيةً)، و«اعتمد» هناك يؤرشفها ويحسمها. و«ارفض» يقول لمرسلها
 * لماذا.
 */
export function TeamCaptures({ items, canSeeAmounts }: { items: TeamCaptureItem[]; canSeeAmounts: boolean }) {
  const router = useRouter();
  const [opening, setOpening] = useState<string | null>(null);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function review(item: TeamCaptureItem) {
    setOpening(item.id);
    try {
      const res = await fetch(`/api/capture/file?id=${encodeURIComponent(item.id)}`);
      if (!res.ok) {
        const read = await readResponse(res);
        toast({ tone: "danger", title: "تعذّر فتح الصورة", body: read.ok ? undefined : read.error });
        if (res.status === 404) router.refresh();
        return;
      }
      const blob = await res.blob();
      const ext = item.mimeType === "application/pdf" ? "pdf" : "jpg";
      const file = tagCapture(new File([blob], `من-${item.sender}.${ext}`, { type: item.mimeType }), item.id);
      queueCapture([file]);
      setOpened((s) => new Set(s).add(item.id));
      /* القارئُ تحت القائمة — تُرى البطاقةُ حين تُقرأ */
      document.getElementById("reader")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {
      toast({ tone: "danger", title: "تعذّر الاتصال", body: "تأكد من الشبكة ثم أعد المحاولة." });
    } finally {
      setOpening(null);
    }
  }

  async function reject(id: string) {
    setBusy(true);
    const res = await postJson("/api/capture/decide", { id, reason });
    setBusy(false);
    if (!res.ok) {
      toast({ tone: "danger", title: "لم تُرفض", body: res.error });
      return;
    }
    toast({ tone: "ok", title: "رُفضت الصورة", body: "سيرى من صوّرها السبب في صفحته." });
    setRejecting(null);
    setReason("");
    router.refresh();
  }

  return (
    <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
      {items.map((item) => {
        const v = item.verdict;
        const isImage = item.mimeType.startsWith("image/");
        return (
          <li key={item.id} className="px-4 py-3">
            <div className="flex items-start gap-3">
              <span className="grid h-16 w-12 shrink-0 place-items-center overflow-hidden rounded-md border border-line bg-sunken">
                {isImage ? (
                  /* eslint-disable-next-line @next/next/no-img-element -- صورةٌ محروسة بالجلسة لا تمرّ بمحسّن الصور */
                  <img src={`/api/capture/file?id=${encodeURIComponent(item.id)}`} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <FileText className="h-5 w-5 text-muted" aria-hidden />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <span className="font-bold">{v?.read.supplier ?? "مورّد لم يُقرأ"}</span>
                  {canSeeAmounts && v?.read.total && <span className="nums text-ink-soft"> · {v.read.total} ريال</span>}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  من {item.sender} · {timeAgo(item.createdAt)}
                  {v?.read.invoiceNumber && <> · رقم <span className="nums" dir="ltr">{v.read.invoiceNumber}</span></>}
                </p>
                {v ? (
                  v.level === "CLEAR" ? (
                    <p className="mt-1 flex items-center gap-1 text-xs text-ok"><CircleCheck className="h-3.5 w-3.5" aria-hidden /> قُرئت كاملة</p>
                  ) : (
                    <p className="mt-1 flex items-center gap-1 text-xs text-warn"><CircleAlert className="h-3.5 w-3.5" aria-hidden /> لم يُقرأ: {v.missing.join("، ")}</p>
                  )
                ) : (
                  <p className="mt-1 text-xs text-muted">{item.readError ?? "لم تُقرأ بعد. تُقرأ حين تفتحها."}</p>
                )}
                {item.note && <p className="mt-1 rounded-md bg-sand-bg px-2 py-1 text-xs text-ink-soft">«{item.note}»</p>}
              </div>
            </div>

            {rejecting === item.id ? (
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {REASONS.map((r) => (
                    <button key={r} type="button" onClick={() => setReason(r)}
                      className={`min-h-11 rounded-full border px-3 text-xs sm:min-h-8 ${reason === r ? "border-accent bg-accent-soft font-bold" : "border-line"}`}>
                      {r}
                    </button>
                  ))}
                </div>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value.slice(0, 300))}
                  placeholder="أو اكتب السبب"
                  aria-label="سبب الرفض"
                  className="w-full rounded-lg border border-line-input bg-raised px-3 py-2 text-sm"
                />
                <div className="flex gap-2">
                  <button type="button" disabled={busy || reason.trim().length < 2} aria-busy={busy}
                    onClick={() => void reject(item.id)} className={buttonClass("danger", "sm")}>
                    ارفضها
                  </button>
                  <button type="button" onClick={() => { setRejecting(null); setReason(""); }} className={buttonClass("quiet", "sm")}>
                    <X className="h-3.5 w-3.5" aria-hidden /> تراجع
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" disabled={opening === item.id} aria-busy={opening === item.id}
                  onClick={() => void review(item)} className={buttonClass(opened.has(item.id) ? "secondary" : "primary", "sm")}>
                  <ScanEye className="h-4 w-4" aria-hidden /> {opened.has(item.id) ? "مفتوحة في القارئ" : "راجعها واعتمدها"}
                </button>
                <button type="button" onClick={() => { setRejecting(item.id); setReason(""); }} className={buttonClass("quiet", "sm")}>
                  ارفضها
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
