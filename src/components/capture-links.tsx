"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Link2, Plus, Share2 } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { timeAgo } from "@/lib/arabic";
import { buttonClass } from "./ui-tokens";
import { ConfirmAction, toast } from "./ui-client";

export interface CaptureLinkItem {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  sent: number;
  waiting: number;
}

/**
 * روابطُ تصوير الفريق — رابطٌ لكلّ باريستا يصوّر به الفاتورة الورقيّة بلا دخول.
 *
 * الرابطُ يُرى مرّةً واحدة حين يُنشأ (لا يُحفظ إلّا بصمتُه): يُرسَل إلى صاحبه
 * فيفتحه ويضيفه إلى شاشته الرئيسيّة. ومن ترك العمل أو ضاع جوالُه يُلغى رابطُه،
 * وتبقى صورُه بما أُرسلت.
 */
export function CaptureLinks({ links }: { links: CaptureLinkItem[] }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<{ label: string; url: string } | null>(null);

  async function create() {
    setBusy(true);
    const res = await postJson<{ id: string; token: string }>("/api/capture-link", { action: "create", label });
    setBusy(false);
    if (!res.ok) {
      toast({ tone: "danger", title: "لم يُنشأ الرابط", body: res.error });
      return;
    }
    setFresh({ label: label.trim(), url: `${window.location.origin}/c/${res.data.token}` });
    setLabel("");
    router.refresh();
  }

  async function revoke(id: string) {
    const res = await postJson("/api/capture-link", { action: "revoke", id });
    if (!res.ok) {
      toast({ tone: "danger", title: "لم يُلغَ الرابط", body: res.error });
      return false;
    }
    toast({ tone: "ok", title: "أُلغي الرابط", body: "لم يعد يفتح صفحة التصوير." });
    router.refresh();
    return true;
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast({ tone: "ok", title: "نُسخ الرابط", duration: 2500 });
    } catch {
      toast({ tone: "warn", title: "تعذّر النسخ", body: "حدّد الرابط وانسخه بنفسك." });
    }
  }

  const message = (f: { label: string; url: string }) =>
    `أهلاً ${f.label}، هذا رابطك لتصوير الفواتير الورقية حين تستلمها:\n${f.url}\nافتحه من جوالك، ثم أضفه إلى الشاشة الرئيسية (مشاركة ← إضافة إلى الشاشة الرئيسية).`;

  return (
    <div className="space-y-4">
      {fresh && (
        <div className="rounded-xl border border-ok/30 bg-ok-bg px-4 py-3">
          <p className="text-sm font-bold text-ok">رابط {fresh.label} جاهز</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-soft">
            أرسله له الآن. لن يظهر الرابط مرة أخرى، وإن ضاع فأنشئ رابطاً جديداً وألغِ هذا.
          </p>
          <p className="mt-2 break-all rounded-md bg-raised px-2 py-1.5 text-xs" dir="ltr">{fresh.url}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => void copy(fresh.url)} className={buttonClass("secondary", "sm")}>
              <Copy className="h-3.5 w-3.5" aria-hidden /> انسخ
            </button>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(message(fresh))}`}
              target="_blank"
              rel="noreferrer"
              className={buttonClass("primary", "sm")}
            >
              <Share2 className="h-3.5 w-3.5" aria-hidden /> أرسله بالواتساب
            </a>
          </div>
        </div>
      )}

      {links.length > 0 && (
        <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
          {links.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-bold">
                  <Link2 className="h-3.5 w-3.5 text-muted" aria-hidden /> {l.label}
                </span>
                <span className="mt-0.5 block text-xs text-muted">
                  {l.sent === 0 ? "لم يرسل شيئاً بعد" : `أرسل ${l.sent.toLocaleString("ar-SA")}`}
                  {l.waiting > 0 && ` · ${l.waiting.toLocaleString("ar-SA")} تنتظر`}
                  {l.lastUsedAt && ` · آخر إرسال ${timeAgo(l.lastUsedAt)}`}
                </span>
              </span>
              <ConfirmAction
                label="ألغِ الرابط"
                title={`إلغاء رابط ${l.label}`}
                consequence="لن يفتح الرابط صفحة التصوير بعد الآن. ما أرسله قبل الإلغاء يبقى كما هو."
                acknowledgement="فهمت أن الرابط سيتوقف ولا يعود"
                confirmLabel="ألغِ الرابط"
                variant="quiet"
                onConfirm={() => revoke(l.id)}
              />
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => { e.preventDefault(); if (label.trim()) void create(); }}
      >
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value.slice(0, 60))}
          placeholder="اسم الموظف، مثلاً: محمد"
          aria-label="اسم الموظف"
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-line-input bg-raised px-3 text-sm sm:min-h-10"
        />
        <button type="submit" disabled={busy || !label.trim()} aria-busy={busy} className={buttonClass("primary", "md")}>
          <Plus className="h-4 w-4" aria-hidden /> أنشئ رابطاً
        </button>
      </form>
    </div>
  );
}
