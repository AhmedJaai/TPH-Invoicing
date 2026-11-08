"use client";

/**
 * «وصلت» — فواتيرُ الفريق عند مستلمها (موظّف المشتريات) في TPH Team: كلُّ صورةٍ صوّرها أيُّ موظّف،
 * يفتحها ليُدخلها في فودكس ويعلّمها «أدخلتها». وزرُّ تفعيل التنبيه على جواله.
 */
import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Bell, BellRing, Check, FileText, Undo2, X } from "lucide-react";
import { postJson } from "@/lib/http-client";

export interface InboxItem {
  id: string;
  sender: string;
  createdAt: string;
  note: string | null;
  isPdf: boolean;
  viewable: boolean;
  read: { supplier: string | null; invoiceNumber: string | null; invoiceDate: string | null; total: string | null } | null;
  enteredAt: string | null;
  enteredBy: string | null;
}

const when = (iso: string) => new Date(iso).toLocaleString("ar-SA-u-ca-gregory-nu-latn", { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", timeZone: "Asia/Riyadh" });
const fileUrl = (token: string, id: string) => `/api/team/invoice-file?token=${encodeURIComponent(token)}&id=${encodeURIComponent(id)}`;

export function InvoiceInbox({ token, items, subscribed }: { token: string; items: InboxItem[]; subscribed: boolean }) {
  const [open, setOpen] = useState<InboxItem | null>(null);
  const waiting = items.filter((i) => !i.enteredAt);
  const done = items.filter((i) => i.enteredAt);
  return (
    <div className="space-y-4">
      <PushToggle token={token} subscribed={subscribed} />
      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">لم تصل فواتير بعد. حين يصوّر أحد الفريق فاتورة تظهر هنا.</p>
      ) : (
        <>
          <section aria-label="لم تُدخل بعد">
            <h2 className="mb-2 text-xs font-bold text-ink-soft">لم تُدخلها في فودكس بعد ({waiting.length})</h2>
            {waiting.length === 0 ? <p className="text-sm text-ok">كلها مُدخلة.</p>
              : <ul className="space-y-2">{waiting.map((i) => <Row key={i.id} token={token} item={i} onOpen={() => setOpen(i)} />)}</ul>}
          </section>
          {done.length > 0 && (
            <details className="rounded-xl border border-line bg-raised">
              <summary className="cursor-pointer px-4 py-3 text-sm font-bold">مُدخلة ({done.length})</summary>
              <ul className="space-y-2 border-t border-line p-2">{done.map((i) => <Row key={i.id} token={token} item={i} onOpen={() => setOpen(i)} />)}</ul>
            </details>
          )}
        </>
      )}
      {open && <Viewer token={token} item={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Row({ token, item, onOpen }: { token: string; item: InboxItem; onOpen: () => void }) {
  return (
    <li className="rounded-xl border border-line bg-raised">
      <button type="button" onClick={onOpen} className="flex w-full items-start gap-3 p-3 text-start" disabled={!item.viewable}>
        {item.viewable && !item.isPdf
          ? /* eslint-disable-next-line @next/next/no-img-element -- صورةٌ محروسة برمز الرابط لا تمرّ بمحسّن الصور */
            <img src={`${fileUrl(token, item.id)}`} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-16 w-14 shrink-0 rounded-lg border border-line bg-sunken object-cover" />
          : <span className="flex h-16 w-14 shrink-0 items-center justify-center rounded-lg border border-line bg-sunken"><FileText className="h-5 w-5 text-muted" aria-hidden /></span>}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold">{item.read?.supplier ?? "مورّد لم يُقرأ"}</span>
          <span className="block text-xs text-ink-soft">
            {item.read?.invoiceNumber && <>رقم <span className="nums">{item.read.invoiceNumber}</span> · </>}
            {item.read?.total && <><span className="nums">{item.read.total}</span> ريال</>}
          </span>
          <span className="mt-0.5 block text-[11px] text-muted">من {item.sender} · {when(item.createdAt)}</span>
          {item.enteredAt && <span className="mt-0.5 block text-[11px] font-bold text-ok">أدخلها {item.enteredBy ?? ""}</span>}
        </span>
      </button>
    </li>
  );
}

function Viewer({ token, item, onClose }: { token: string; item: InboxItem; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function mark(entered: boolean) {
    if (busy) return;
    setBusy(true); setError(null);
    const r = await postJson("/api/team/invoices", { token, id: item.id, entered });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    router.refresh();
    onClose();
  }
  const url = fileUrl(token, item.id);
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface" role="dialog" aria-modal="true" aria-label="الفاتورة">
      <div className="flex items-center gap-3 border-b border-line px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button type="button" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-hover" aria-label="أغلق"><X className="h-5 w-5" aria-hidden /></button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{item.read?.supplier ?? "فاتورة"}</p>
          <p className="truncate text-[11px] text-muted">من {item.sender}</p>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-sunken p-2">
        {!item.viewable ? <p className="p-6 text-center text-sm text-muted">لا ملف لهذه الفاتورة.</p>
          : item.isPdf ? <iframe src={url} title="الفاتورة" className="h-full w-full rounded-lg bg-raised" />
          : /* eslint-disable-next-line @next/next/no-img-element -- صورةٌ محروسة برمز الرابط لا تمرّ بمحسّن الصور */
            <img src={url} alt="صورة الفاتورة" referrerPolicy="no-referrer" className="mx-auto max-w-full rounded-lg" />}
      </div>
      <div className="space-y-2 border-t border-line px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        {item.read && (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted">الرقم</dt><dd className="nums font-bold">{item.read.invoiceNumber ?? "—"}</dd>
            <dt className="text-muted">التاريخ</dt><dd className="nums font-bold">{item.read.invoiceDate ?? "—"}</dd>
            <dt className="text-muted">الإجمالي</dt><dd className="nums font-bold">{item.read.total ? `${item.read.total} ريال` : "—"}</dd>
          </dl>
        )}
        {item.note && <p className="text-xs">ملاحظة المصوِّر: {item.note}</p>}
        {error && <p role="alert" className="text-xs font-bold text-danger">{error}</p>}
        {item.enteredAt
          ? <button type="button" onClick={() => void mark(false)} disabled={busy} aria-busy={busy} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-line font-bold text-ink-soft"><Undo2 className="h-4 w-4" aria-hidden />لم أُدخلها بعد</button>
          : <button type="button" onClick={() => void mark(true)} disabled={busy} aria-busy={busy} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent font-bold text-accent-ink"><Check className="h-4 w-4" aria-hidden />{busy ? "يُحفظ…" : "أدخلتها في فودكس"}</button>}
      </div>
    </div>
  );
}

/* ─────────────── التنبيه على الجوال ─────────────── */

const noSubscribe = () => () => {};
type PushSupport = "unknown" | "unsupported" | "needs-install" | "ok";
function pushSupport(): PushSupport {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia("(display-mode: standalone)").matches;
    return ios && !standalone ? "needs-install" : "unsupported";
  }
  return "ok";
}

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function PushToggle({ token, subscribed: initial }: { token: string; subscribed: boolean }) {
  const support = useSyncExternalStore(noSubscribe, pushSupport, (): PushSupport => "unknown");
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enable() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setError("لم يُسمح بالتنبيهات. اسمح بها من إعدادات الجوال ثم أعد المحاولة."); return; }
      const k = await (await fetch("/api/team/push", { cache: "no-store" })).text();
      const publicKey = (JSON.parse(k) as { publicKey?: string | null }).publicKey;
      if (!publicKey) { setError("التنبيهات غير مفعّلة على الخادم بعد. أخبر الإدارة."); return; }
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: `/a/${token}` });
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      const r = await postJson("/api/team/push", { token, endpoint: json.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth });
      if (!r.ok) { setError(r.error); return; }
      setOn(true);
    } catch {
      setError("تعذّر تفعيل التنبيه على هذا الجوال.");
    } finally {
      setBusy(false);
    }
  }

  if (on) return <p className="flex items-center gap-2 rounded-xl border border-ok/25 bg-ok-bg px-3 py-2 text-xs font-bold text-ok"><BellRing className="h-4 w-4" aria-hidden />يصلك تنبيه بكل فاتورة جديدة.</p>;
  if (support === "unknown") return null;
  if (support === "needs-install") return <p className="rounded-xl border border-line bg-raised px-3 py-2 text-xs text-ink-soft">لتصلك التنبيهات: أضف التطبيق إلى الشاشة الرئيسية، وافتحه منها، ثم فعّلها هنا.</p>;
  if (support === "unsupported") return <p className="rounded-xl border border-line bg-raised px-3 py-2 text-xs text-muted">هذا المتصفح لا يدعم التنبيهات.</p>;
  return (
    <div>
      <button type="button" onClick={() => void enable()} disabled={busy} aria-busy={busy}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-accent-line bg-accent-soft/40 font-bold text-ink">
        <Bell className="h-4 w-4" aria-hidden />{busy ? "يُفعَّل…" : "فعّل تنبيه الفواتير الجديدة"}
      </button>
      {error && <p role="alert" className="mt-2 text-xs font-bold text-danger">{error}</p>}
    </div>
  );
}
