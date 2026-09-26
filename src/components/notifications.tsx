"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, CircleAlert, CircleCheck, CloudOff, FileText, Info, RefreshCw, TriangleAlert } from "lucide-react";
import { request, postJson } from "@/lib/http-client";
import { timeAgo } from "@/lib/arabic";
import type { NoticeFeed, Notice } from "@/services/notifications.service";
import { Sheet } from "./ui-client";

/**
 * مركزُ الإشعارات والملخّصُ اليوميّ.
 *
 * الجرسُ يقول كم جديداً منذ آخر قراءة، ويُفتح على لوحين: «الجديد» (ما
 * وقع مرتّباً بالأحدث، ولكلٍّ موضعُه) و«ملخّص اليوم» (آخر ٢٤ ساعة
 * بأعدادها). و«علّم الكلّ مقروءاً» يكتب حدّاً في القاعدة فيصحّ على كلّ
 * أجهزتك.
 *
 * ولا يُطلَب شيءٌ والنافذةُ في الخلفيّة: السؤالُ كلَّ ثلاث دقائق حين
 * تكون ظاهرة، ومع كلّ فتح.
 */

const POLL_MS = 3 * 60 * 1000;

const ICON = {
  DOCUMENTS: FileText,
  REVIEW: TriangleAlert,
  STALLED: CircleAlert,
  OVERDUE: TriangleAlert,
  DRIVE: CloudOff,
  ACTIVITY: CircleCheck,
} as const;

const TONE = { ok: "text-ok bg-ok-bg", warn: "text-warn bg-warn-bg", danger: "text-danger bg-danger-bg", info: "text-info bg-info-bg" } as const;


export function NotificationsBell({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname();
  const [feed, setFeed] = useState<NoticeFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"new" | "digest">("new");
  const [marking, setMarking] = useState(false);
  const loading = useRef(false);
  const hasFeed = useRef(false);

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const r = await request<NoticeFeed>("/api/notifications");
      if (r.ok) {
        setFeed(r.data);
        hasFeed.current = true;
        setError(null);
      } else if (r.status !== 429 || !hasFeed.current) {
        /* الحدُّ المؤقّت في سؤالٍ دوريّ لا يُعرَض عطباً ما دام ما عُرض قبله باقياً */
        setError(r.error);
      }
    } finally {
      loading.current = false;
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [load]);

  /* الانتقالُ يغلق اللوح — يُضبط أثناء الرسم لا في أثر */
  const [shownFor, setShownFor] = useState(pathname);
  if (shownFor !== pathname) {
    setShownFor(pathname);
    setOpen(false);
  }

  async function markSeen() {
    setMarking(true);
    const r = await postJson<{ seenAt: string }>("/api/notifications", { action: "seen" });
    setMarking(false);
    if (r.ok && feed) setFeed({ ...feed, unread: 0, seenAt: r.data.seenAt });
    else if (!r.ok) setError(r.error);
  }

  const unread = feed?.unread ?? 0;

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); void load(); }}
        aria-label={unread > 0 ? `الإشعارات — ${unread} جديد` : "الإشعارات"}
        aria-haspopup="dialog"
        data-tip="الإشعارات"
        className={`relative grid shrink-0 place-items-center rounded-lg text-ink-soft transition-colors hover:bg-hover hover:text-ink ${compact ? "h-11 w-11" : "h-9 w-9"}`}
      >
        <Bell className="h-[18px] w-[18px]" strokeWidth={1.9} aria-hidden />
        {unread > 0 && (
          <span dir="ltr" className="nums absolute end-1 top-1 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] font-bold leading-4 text-raised">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="الإشعارات"
        description="ما تغيّر منذ آخر مرّة، وملخّصُ آخر ٢٤ ساعة."
        footer={
          <>
            <button type="button" onClick={() => void load()} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-xs font-bold text-ink-soft hover:bg-hover sm:min-h-8">
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} aria-hidden /> حدّث
            </button>
            <button
              aria-busy={marking}
              type="button"
              disabled={marking || unread === 0}
              onClick={markSeen}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-bold text-accent-ink disabled:opacity-50 sm:min-h-8"
            >
              <CheckCheck className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              علّم الكلّ مقروءاً
            </button>
          </>
        }
      >
        <div role="tablist" aria-label="الإشعارات" className="mb-4 inline-flex rounded-lg bg-sunken p-1">
          {([["new", "الجديد"], ["digest", "ملخّص اليوم"]] as const).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              type="button"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`min-h-9 rounded-md px-3 text-xs font-bold transition-colors ${tab === k ? "bg-raised text-ink shadow-raised" : "text-muted hover:text-ink"}`}
            >
              {label}
              {k === "new" && unread > 0 && <span className="nums ms-1.5 rounded-full bg-danger px-1.5 text-[10px] text-raised">{unread}</span>}
            </button>
          ))}
        </div>

        {error && (
          <p role="alert" className="mb-3 flex items-center gap-2 rounded-lg bg-danger-bg px-3 py-2 text-xs text-danger">
            <CircleAlert className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden /> {error}
          </p>
        )}

        {!feed && !error && (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-14" />)}
            <span className="sr-only">يُحمّل…</span>
          </div>
        )}

        {feed && tab === "new" && (
          feed.notices.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
              لم يقع شيءٌ في الأسبوعين الماضيين يستحقّ إشعاراً.
            </p>
          ) : (
            <ul className="space-y-1">
              {feed.notices.map((n) => (
                <NoticeRow key={n.id} n={n} unread={!feed.seenAt || n.at > feed.seenAt} />
              ))}
            </ul>
          )
        )}

        {feed && tab === "digest" && <DigestPanel feed={feed} />}
      </Sheet>
    </>
  );
}

function NoticeRow({ n, unread }: { n: Notice; unread: boolean }) {
  const Icon = n.tone === "info" && n.kind !== "DOCUMENTS" ? Info : ICON[n.kind];
  return (
    <li>
      <Link href={n.href} className="flex items-start gap-3 rounded-xl px-2.5 py-2.5 transition-colors hover:bg-hover">
        <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${TONE[n.tone]}`}>
          <Icon className="h-4 w-4" strokeWidth={2} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className={`truncate text-[13px] ${unread ? "font-bold" : "font-medium text-ink-soft"}`}>{n.title}</span>
            <span className="shrink-0 text-[11px] text-muted">{timeAgo(n.at)}</span>
          </span>
          {n.body && <span className="mt-0.5 block text-xs leading-relaxed text-muted">{n.body}</span>}
        </span>
        {unread && <span aria-label="جديد" className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent" />}
      </Link>
    </li>
  );
}

function DigestPanel({ feed }: { feed: NoticeFeed }) {
  const d = feed.digest;
  const rows: { label: string; n: number; href: string }[] = [
    { label: "مستنداتٌ وصلت", n: d.documentsArrived, href: "/documents" },
    { label: "أُرشِفت وقُيِّدت", n: d.documentsArchived, href: "/documents" },
    { label: "تنتظر مراجعتك الآن", n: d.needsReview, href: "/documents" },
    { label: "دفعاتٌ قُيِّدت", n: d.paymentsRecorded, href: "/bank" },
    { label: "قراراتٌ حُسمت", n: d.decisionsTaken, href: "/settings/audit" },
  ];
  const quiet = rows.every((r) => r.n === 0);
  return (
    <div>
      {quiet && (
        <p className="mb-3 rounded-lg bg-sunken px-3 py-2 text-xs text-muted">
          يومٌ هادئ: لم يصل مستندٌ ولم يُحسم قرارٌ في آخر ٢٤ ساعة.
        </p>
      )}
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-raised">
        {rows.map((r) => (
          <li key={r.label}>
            <Link href={r.href} className="flex min-h-12 items-center justify-between gap-3 px-4 transition-colors hover:bg-hover">
              <span className="text-[13px]">{r.label}</span>
              <span className={`nums text-base font-bold ${r.n === 0 ? "text-muted" : ""}`}>{r.n}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
