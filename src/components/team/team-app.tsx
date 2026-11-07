"use client";

/**
 * «TPH Team» — تطبيقُ الموظّف: ثلاثُ صفحاتٍ في رابطٍ واحد، وشريطُ تبويبٍ في أسفل الشاشة كتطبيقٍ
 * مثبَّت. الصفحةُ المفتوحة تُكتب في العنوان (`?tab=`) فتبقى بعد التحديث، ويبدأ التطبيقُ المثبَّت
 * بالحضور.
 *
 * والماسحُ ثقيل (نموذجُ زوايا الورقة) فلا يُحمَّل حتّى تُفتح صفحةُ الفواتير.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { BookOpen, Clock, Inbox, Megaphone, ScanLine, Share, SquarePlus, X } from "lucide-react";
import { BrandMark } from "@/components/icons";
import { TEAM_APP_NAME, TEAM_TABS, type TeamTab } from "@/lib/team-app";
import { AttendPanel, type AttendPanelProps } from "./attend-panel";
import type { MyMessageView } from "./message-panel";
import { BoardPanel, type BoardCard } from "./board-panel";
import { RequestsPanel, type MyRequestView, type StockOption } from "./requests-panel";
import type { SentItem } from "@/components/scan/scanner";

const Scanner = dynamic(() => import("@/components/scan/scanner").then((m) => m.Scanner), {
  ssr: false,
  loading: () => <p className="py-10 text-center text-sm text-muted" role="status">يُفتح الماسح…</p>,
});

const ICON: Record<TeamTab, typeof Clock> = { attend: Clock, board: BookOpen, invoices: ScanLine, requests: Inbox };

export interface TeamAppProps {
  token: string;
  name: string;
  initialTab: TeamTab;
  attend: Omit<AttendPanelProps, "token">;
  captures: SentItem[];
  messages: MyMessageView[];
  board: BoardCard[];
  pendingBoardIds: string[];
  todayWeekday: number;
  requests: MyRequestView[];
  mates: { id: string; name: string; daysOff: string }[];
  myDaysOff: string;
  stock: StockOption[];
}

const SEEN_KEY = "tph-team.seen-replies";

const noSubscribe = () => () => {};

/** آخرُ ردٍّ رآه الموظّف — نقطةٌ على «رسالة للإدارة» حين يصل ردٌّ جديد. راحةٌ لا حقيقة: تُقرأ بحذر. */
function readSeen(): string {
  try { return window.localStorage.getItem(SEEN_KEY) ?? ""; } catch { return ""; }
}
function writeSeen(v: string) {
  try { window.localStorage.setItem(SEEN_KEY, v); } catch { /* تخزينٌ ممنوع: تبقى النقطة */ }
}

export function TeamApp({ token, name, initialTab, attend, captures, messages, board, pendingBoardIds, todayWeekday, requests, mates, stock, myDaysOff }: TeamAppProps) {
  const announcements = board.filter((c) => c.kind === "ANNOUNCEMENT");
  const [tab, setTab] = useState<TeamTab>(initialTab);
  const latestReply = messages.reduce<string>((m, x) => (x.repliedAt && x.repliedAt > m ? x.repliedAt : m), "");
  /* في الخادم لا تخزين: لا نقطة حتى يُقرأ الجوال */
  const stored = useSyncExternalStore(noSubscribe, readSeen, () => null);
  const [seenNow, setSeen] = useState<string | null>(null);
  const seen = seenNow ?? stored;
  const newReply = seen !== null && latestReply !== "" && latestReply > seen && tab !== "requests";

  function open(next: TeamTab) {
    setTab(next);
    if (next === "requests" && latestReply) { writeSeen(latestReply); setSeen(latestReply); }
    try {
      const url = new URL(window.location.href);
      if (next === "attend") url.searchParams.delete("tab"); else url.searchParams.set("tab", next);
      window.history.replaceState(null, "", url);
    } catch { /* العنوانُ راحةٌ لا شرط */ }
    window.scrollTo({ top: 0 });
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-surface">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-surface/95 px-4 pb-2.5 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        <BrandMark className="h-8 w-auto text-accent" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold tracking-wide text-muted" dir="ltr" lang="en">{TEAM_APP_NAME}</p>
          <h1 className="truncate text-base font-bold">أهلاً {name}</h1>
        </div>
      </header>

      <main className="flex-1 px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-4">
        {tab === "attend" && (
          <>
            <InstallHint />
            {announcements.map((a) => (
              <aside key={a.id} className="mb-4 flex items-start gap-3 rounded-2xl border border-accent-line bg-raised p-3.5">
                <Megaphone className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
                <div className="min-w-0"><p className="text-sm font-bold">{a.title}</p>{a.body && <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-ink-soft">{a.body}</p>}</div>
              </aside>
            ))}
            <AttendPanel token={token} {...attend} />
          </>
        )}
        {tab === "board" && <BoardPanel token={token} cards={board} todayWeekday={todayWeekday} pendingIds={pendingBoardIds} />}
        {tab === "invoices" && <Scanner token={token} label={name} recent={captures} embedded />}
        {tab === "requests" && <RequestsPanel token={token} today={attend.today} messages={messages} requests={requests} mates={mates} stock={stock} myDaysOff={myDaysOff} />}
      </main>

      <nav aria-label="أقسام التطبيق" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-raised/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <ul className="mx-auto grid max-w-lg grid-cols-4">
          {TEAM_TABS.map((t) => {
            const Icon = ICON[t.id];
            const active = tab === t.id;
            return (
              <li key={t.id}>
                <button type="button" onClick={() => open(t.id)} aria-current={active ? "page" : undefined}
                  className={`relative flex min-h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-bold transition-colors ${active ? "text-accent" : "text-muted hover:text-ink"}`}>
                  <span className={`flex h-8 w-14 items-center justify-center rounded-full transition-colors ${active ? "bg-accent-soft" : ""}`}>
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  {t.label}
                  {t.id === "requests" && newReply && (
                    <span className="absolute top-2 h-2.5 w-2.5 translate-x-4 rounded-full bg-danger ring-2 ring-raised" aria-label="رد جديد من الإدارة" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

/* ─────────────── «ثبّته على شاشتك» ─────────────── */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const HINT_KEY = "tph-team.install-hint";

/**
 * يظهر في المتصفّح وحده — لا داخل التطبيق المثبَّت. في الآيفون يقول أين الزرّ (لا يُثبَّت من
 * الصفحة)، وفي أندرويد يثبّته بضغطة. ويُخفى إن أغلقه الموظّف.
 */
type HintMode = "hidden" | "ios" | "android" | "other";

/** أين يُفتح: في التطبيق المثبَّت (أو أُخفيت الملاحظة) لا تظهر، وفي المتصفّح بحسب الجوال. */
function hintMode(): HintMode {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  let dismissed = false;
  try { dismissed = window.localStorage.getItem(HINT_KEY) === "1"; } catch { /* يظهر */ }
  if (standalone || dismissed) return "hidden";
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return ios ? "ios" : /Android/.test(ua) ? "android" : "other";
}

function InstallHint() {
  const detected = useSyncExternalStore(noSubscribe, hintMode, (): HintMode => "hidden");
  const [closed, setClosed] = useState(false);
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const mode: HintMode = closed ? "hidden" : detected;

  useEffect(() => {
    if (detected !== "android") return;
    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e as InstallPromptEvent); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, [detected]);

  if (mode === "hidden" || mode === "other") return null;
  const close = () => { setClosed(true); try { window.localStorage.setItem(HINT_KEY, "1"); } catch { /* يعود في الزيارة القادمة */ } };

  return (
    <aside className="mb-4 flex items-start gap-3 rounded-2xl border border-accent-line bg-accent-soft/50 p-3.5 text-sm leading-relaxed">
      <SquarePlus className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-bold">ثبّت {TEAM_APP_NAME} على شاشة جوالك</p>
        {mode === "ios" ? (
          <p className="mt-1 text-ink-soft">
            اضغط زر المشاركة <Share className="inline h-4 w-4 align-[-3px]" aria-label="مشاركة" /> في أسفل سفاري، ثم «إضافة إلى الشاشة الرئيسية». يفتح بعدها مباشرة بلا تسجيل دخول.
          </p>
        ) : prompt ? (
          <button type="button" className="mt-2 min-h-11 rounded-lg bg-accent px-4 font-bold text-accent-ink" onClick={async () => {
            await prompt.prompt();
            const choice = await prompt.userChoice;
            if (choice.outcome === "accepted") close();
            setPrompt(null);
          }}>ثبّته الآن</button>
        ) : (
          <p className="mt-1 text-ink-soft">من قائمة المتصفح ⋮ اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».</p>
        )}
      </div>
      <button type="button" onClick={close} className="-m-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-hover" aria-label="أخفِ هذه الملاحظة">
        <X className="h-4 w-4" aria-hidden />
      </button>
    </aside>
  );
}
