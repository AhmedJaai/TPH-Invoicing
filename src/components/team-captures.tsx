"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, FileText, Loader2, Play, ScanEye, UsersRound, X } from "lucide-react";
import { postJson } from "@/lib/http-client";
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
  sizeBytes: number;
  verdict: ClarityVerdict | null;
  readError: string | null;
}

/** حالُ الصورة في القارئ: تُهيَّأ · جاهزة · تعثّرت · اعتُمدت — أو لم تُفتح */
export type TeamCaptureStatus = "opening" | "ready" | "failed" | "archived" | null;

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
 * البطاقةُ تُفتح تحت صورتها لا في قارئٍ بعيد (`renderOpen`)، و«اعتمد» يفتح التاليةَ في
 * المكان نفسه وقد هُيِّئت في الخلفية. والحالُ كلُّها عند القارئ (`Uploader`) — هذه تعرض
 * وتُبلغ. و«ارفض» يقول لمرسلها لماذا، ولا تُحذف الصورة.
 */
export function TeamCaptures({
  items, canSeeAmounts, focus, statusOf, renderOpen, onReview, onRejected,
}: {
  items: TeamCaptureItem[];
  canSeeAmounts: boolean;
  /** الصورةُ المفتوحة بطاقتُها الآن */
  focus: string | null;
  statusOf: (id: string) => TeamCaptureStatus;
  /** بطاقةُ الصورة المفتوحة — تُرسم تحتها */
  renderOpen: (id: string) => React.ReactNode;
  onReview: (item: TeamCaptureItem) => void;
  onRejected: (id: string) => void;
}) {
  const router = useRouter();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

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
    onRejected(id);
    router.refresh();
  }

  const first = items.find((i) => statusOf(i.id) !== "archived");

  return (
    <section id="team" className="mb-10 scroll-mt-24">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="flex items-center gap-2 text-[15px] font-bold leading-tight sm:text-base">
          <UsersRound className="h-[18px] w-[18px] text-muted" strokeWidth={1.75} aria-hidden />
          صوّرها الفريق، وتنتظرك
          <span className="nums nums-count rounded-full bg-sunken px-2 py-0.5 text-[11px] font-bold text-ink-soft">{items.length}</span>
        </h2>
        {focus === null && first && (
          <button type="button" onClick={() => onReview(first)} className={buttonClass("primary", "sm")}>
            <Play className="h-4 w-4" aria-hidden /> ابدأ المراجعة من الأقدم
          </button>
        )}
      </div>
      <p className="mb-3 text-xs leading-relaxed text-muted">
        تُفتح كل صورة في مكانها، وبعد «اعتمد» تُفتح التالية جاهزة. لا يُعتمد شيء دون ضغطتك، ولا تُحذف صورة: المرفوضة تبقى بسببها.
      </p>

      <ul className="divide-y divide-line-soft overflow-clip rounded-xl border border-line bg-raised shadow-raised">
        {items.map((item) => {
          const v = item.verdict;
          const isImage = item.mimeType.startsWith("image/");
          const status = statusOf(item.id);
          const open = focus === item.id;
          return (
            <li key={item.id} id={`capture-${item.id}`} className={`scroll-mt-20 px-4 py-3 ${open ? "bg-accent-soft/40" : ""}`}>
              <div className="flex items-start gap-3">
                <span className="grid h-16 w-12 shrink-0 place-items-center overflow-hidden rounded-md border border-line bg-sunken">
                  {isImage ? (
                    /* eslint-disable-next-line @next/next/no-img-element -- صورةٌ محروسة بالجلسة لا تمرّ بمحسّن الصور */
                    <img src={`/api/capture/file?id=${encodeURIComponent(item.id)}&thumb=1`} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
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
                    من {item.sender} · <span suppressHydrationWarning>{timeAgo(item.createdAt)}</span>
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

              {status === "archived" ? (
                <p className="mt-2 flex items-center gap-1.5 text-xs font-bold text-ok">
                  <CircleCheck className="h-4 w-4" aria-hidden /> اعتُمدت
                </p>
              ) : rejecting === item.id ? (
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
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {!open && (
                    <button type="button" onClick={() => onReview(item)} className={buttonClass("primary", "sm")}>
                      <ScanEye className="h-4 w-4" aria-hidden /> {status === "ready" ? "افتحها، جاهزة" : "راجعها واعتمدها"}
                    </button>
                  )}
                  <button type="button" onClick={() => { setRejecting(item.id); setReason(""); }} className={buttonClass("quiet", "sm")}>
                    ارفضها
                  </button>
                  {!open && status === "opening" && (
                    <span className="flex items-center gap-1 text-xs text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> تُهيَّأ</span>
                  )}
                </div>
              )}

              {open && status !== "archived" && <div className="mt-3">{renderOpen(item.id)}</div>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
