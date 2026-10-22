"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { RecordedLabel } from "@/lib/capture-recorded";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, Copy, FileText, Link2, Loader2, Play, ScanEye, UsersRound, X } from "lucide-react";
import { postJson } from "@/lib/http-client";
import type { ClarityVerdict } from "@/lib/capture-clarity";
import { INVOICE, countNoun, timeAgo } from "@/lib/arabic";
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
  /** أمسجّلةٌ من قبل؟ — `null`: لا شيء في الدفاتر يطابقها */
  recorded: RecordedLabel | null;
}

/** «اعتمد المحدَّد» وهو يجري أو بعد أن انتهى — `skipped`: ما تُرك وسببُه */
export interface BulkProgress {
  running: boolean;
  done: number;
  approved: number;
  total: number;
  skipped: Record<string, string>;
}

/** ما يُعرض من القائمة — والانتقالُ إلى التالية يبقى داخله */
export type TeamFilter = "ALL" | "DUPLICATE" | "STATEMENT" | "NEW";

const FILTER_OF = (r: RecordedLabel | null): Exclude<TeamFilter, "ALL"> =>
  !r ? "NEW" : r.kind === "STATEMENT_NO_FILE" ? "STATEMENT" : "DUPLICATE";

const FILTER_LABEL: Record<TeamFilter, string> = {
  ALL: "الكل",
  DUPLICATE: "مسجّلة من قبل",
  STATEMENT: "من كشف المورّد بلا ملف",
  NEW: "جديدة",
};

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
  items, canSeeAmounts, focus, statusOf, renderOpen, onReview, onRejected, onVisible, bulk, onApproveMany,
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
  /** ما يُعرض بترتيبه — فـ«التالية» بعد الاعتماد من داخل التصفية */
  onVisible: (ids: string[] | null) => void;
  bulk: BulkProgress | null;
  /** تُعتمد بالترتيب، كلٌّ بفحص الخادم — وما يحتاج عيناً يُترك */
  onApproveMany: (items: TeamCaptureItem[]) => void;
}) {
  const router = useRouter();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const [filter, setFilter] = useState<TeamFilter>("ALL");
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const running = Boolean(bulk?.running);
  const toggle = (id: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const counts = { ALL: items.length, DUPLICATE: 0, STATEMENT: 0, NEW: 0 } as Record<TeamFilter, number>;
  for (const i of items) counts[FILTER_OF(i.recorded)]++;
  const shown = filter === "ALL" ? items : items.filter((i) => FILTER_OF(i.recorded) === filter);
  const shownKey = filter === "ALL" ? "" : shown.map((i) => i.id).join(",");
  useEffect(() => { onVisible(shownKey ? shownKey.split(",") : null); }, [shownKey, onVisible]);

  async function reject(id: string, why = reason) {
    setBusy(true);
    const res = await postJson("/api/capture/decide", { id, reason: why });
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

  const first = shown.find((i) => statusOf(i.id) !== "archived");
  /* المحدَّدُ القائم وحده — ما اعتُمد أو خرج من القائمة لا يُعدّ */
  const pickedLive = items.filter((i) => picked.has(i.id) && statusOf(i.id) !== "archived");
  const selectable = shown.filter((i) => statusOf(i.id) !== "archived");
  const allShownPicked = selectable.length > 0 && selectable.every((i) => picked.has(i.id));

  function startBulk() {
    setConfirming(false);
    onApproveMany(pickedLive);
    setPicked(new Set());
  }

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

      {(counts.DUPLICATE > 0 || counts.STATEMENT > 0) && (
        <div role="radiogroup" aria-label="اعرض" className="mb-3 flex flex-wrap gap-1.5">
          {(["ALL", "DUPLICATE", "STATEMENT", "NEW"] as const).filter((f) => f === "ALL" || counts[f] > 0).map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={filter === f}
              onClick={() => setFilter(f)}
              className={`min-h-11 rounded-full border px-3 text-xs sm:min-h-8 ${filter === f ? "border-accent bg-accent-soft font-bold" : "border-line"}`}
            >
              {FILTER_LABEL[f]} <span className="nums nums-count text-ink-soft">{counts[f]}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-raised px-3 py-2">
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs sm:min-h-8">
          <input
            type="checkbox"
            checked={allShownPicked}
            disabled={running || selectable.length === 0}
            onChange={() => setPicked(allShownPicked ? new Set() : new Set(selectable.map((i) => i.id)))}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          حدّد كل ما يظهر <span className="nums nums-count text-ink-soft">({selectable.length})</span>
        </label>
        <span className="ms-auto flex flex-wrap items-center gap-2">
          {confirming ? (
            <>
              <span className="text-xs text-ink-soft">تُعتمد {countNoun(pickedLive.length, INVOICE)} واحدةً بعد الأخرى، وما يحتاج مراجعتك يُترك.</span>
              <button type="button" onClick={startBulk} className={buttonClass("primary", "sm")}>
                <CircleCheck className="h-4 w-4" aria-hidden /> نعم، اعتمدها
              </button>
              <button type="button" onClick={() => setConfirming(false)} className={buttonClass("quiet", "sm")}>تراجع</button>
            </>
          ) : (
            <button
              type="button"
              disabled={running || pickedLive.length === 0}
              onClick={() => setConfirming(true)}
              className={buttonClass("primary", "sm")}
            >
              <CircleCheck className="h-4 w-4" aria-hidden /> اعتمد المحدَّد{pickedLive.length > 0 && <> (<span className="nums">{pickedLive.length}</span>)</>}
            </button>
          )}
        </span>
        {bulk && (
          <p className="w-full text-xs" aria-live="polite">
            {bulk.running ? (
              <span className="flex items-center gap-1.5 text-ink-soft">
                <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
                يعتمد {bulk.done} من {bulk.total}…
              </span>
            ) : (
              <span className={Object.keys(bulk.skipped).length > 0 ? "text-warn" : "text-ok"}>
                اعتُمد {bulk.approved} من {bulk.total}
                {Object.keys(bulk.skipped).length > 0 && <>، وبقي {countNoun(Object.keys(bulk.skipped).length, INVOICE)} تحتاج مراجعتك، وسبب كل واحدة تحتها.</>}
              </span>
            )}
          </p>
        )}
      </div>

      <ul className="divide-y divide-line-soft overflow-clip rounded-xl border border-line bg-raised shadow-raised">
        {shown.map((item) => {
          const v = item.verdict;
          const isImage = item.mimeType.startsWith("image/");
          const status = statusOf(item.id);
          const open = focus === item.id;
          return (
            <li key={item.id} id={`capture-${item.id}`} className={`scroll-mt-20 px-4 py-3 ${open ? "bg-accent-soft/40" : ""}`}>
              <div className="flex items-start gap-3">
                {status !== "archived" && (
                  <input
                    type="checkbox"
                    aria-label="حدّدها للاعتماد"
                    checked={picked.has(item.id)}
                    disabled={running}
                    onChange={() => toggle(item.id)}
                    className="mt-6 h-5 w-5 shrink-0 accent-[var(--accent)]"
                  />
                )}
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
                  {item.recorded && <RecordedNote r={item.recorded} />}
                  {bulk?.skipped[item.id] && status !== "archived" && (
                    <p className="mt-1.5 flex items-start gap-1.5 rounded-md border border-warn/30 bg-warn-bg px-2 py-1.5 text-xs leading-relaxed text-warn">
                      <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span>لم تُعتمد مع المحدَّد: {bulk.skipped[item.id]}</span>
                    </p>
                  )}
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
                  {item.recorded?.kind === "RECORDED" || item.recorded?.kind === "TWIN" ? (
                    <button type="button" disabled={busy} aria-busy={busy}
                      onClick={() => void reject(item.id, item.recorded!.kind === "TWIN"
                        ? "صُوّرت مرتين، والصورة الأخرى تنتظر المراجعة"
                        : `وصلت من قبل: الفاتورة ${item.recorded!.invoiceNumber} مسجّلة`)}
                      className={buttonClass("secondary", "sm")}>
                      ارفضها: {item.recorded.kind === "TWIN" ? "صُوّرت مرتين" : "مسجّلة من قبل"}
                    </button>
                  ) : null}
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

/** حالُها في الدفاتر — بما يُفعل بها. */
function RecordedNote({ r }: { r: RecordedLabel }) {
  const link = r.invoiceId ? (
    <Link href={`/purchases/invoices/${r.invoiceId}`} className="font-bold underline-offset-2 hover:underline">
      <bdi dir="ltr" className="nums">{r.invoiceNumber}</bdi>
    </Link>
  ) : <bdi dir="ltr" className="nums">{r.invoiceNumber}</bdi>;
  if (r.kind === "STATEMENT_NO_FILE") {
    return (
      <p className="mt-1.5 flex items-start gap-1.5 rounded-md border border-accent-line bg-accent-soft px-2 py-1.5 text-xs leading-relaxed">
        <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>مسجّلة من كشف المورّد بلا ملف (فاتورة {link}). اعتمدها ليُربط ملفها بقيدها، ولن تُسجَّل مرة ثانية.</span>
      </p>
    );
  }
  if (r.kind === "RECORDED") {
    return (
      <p className="mt-1.5 flex items-start gap-1.5 rounded-md border border-line bg-sunken px-2 py-1.5 text-xs leading-relaxed text-ink-soft">
        <Copy className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>مسجّلة من قبل بملفها: فاتورة {link}{r.supplierName ? <> من {r.supplierName}</> : null}. يمكنك تجاهلها.</span>
      </p>
    );
  }
  if (r.kind === "TWIN") {
    return (
      <p className="mt-1.5 flex items-start gap-1.5 rounded-md border border-line bg-sunken px-2 py-1.5 text-xs leading-relaxed text-ink-soft">
        <Copy className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>صُوّرت مرتين: صورة أقدم للفاتورة {link} نفسها تنتظر في القائمة.</span>
      </p>
    );
  }
  return (
    <p className="mt-1.5 flex items-start gap-1.5 rounded-md border border-warn/30 bg-warn-bg px-2 py-1.5 text-xs leading-relaxed text-warn">
      <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>يُرجَّح أنها مسجّلة: فاتورة {link}{r.supplierName ? <> من {r.supplierName}</> : null} بالرقم والمبلغ نفسيهما. تأكد قبل أن تتجاهلها.</span>
    </p>
  );
}
