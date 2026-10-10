"use client";

import Link from "next/link";
import { useState } from "react";
import { CircleHelp } from "lucide-react";
import { Money } from "./money";
import { Popover } from "./ui-client";
import { request } from "@/lib/http-client";

/**
 * «لماذا هذا الرقم؟» — زرٌّ صغير تحت الرقم الرئيسيّ يفتح آخرَ ما حرّكه.
 *
 * من سجلّ التدقيق القائم (`/api/figure-history`): ماذا وقع، ومتى، ومن فعله (أنت أو
 * النظام)، ورابطُ كلٍّ ليُفحَص أو يُصحَّح. يُجلَب عند الفتح لا مع الصفحة.
 */
interface Mover {
  id: string; when: string; label: string; who: string; automatic: boolean;
  detail: string | null; amountMinor: number | null; href: string | null;
}

function readMovers(v: unknown): Mover[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x): Mover[] => {
    if (typeof x !== "object" || x === null) return [];
    if (!("id" in x) || typeof x.id !== "string" || !("label" in x) || typeof x.label !== "string") return [];
    return [{
      id: x.id,
      label: x.label,
      when: "when" in x && typeof x.when === "string" ? x.when : "",
      who: "who" in x && typeof x.who === "string" ? x.who : "",
      automatic: "automatic" in x && x.automatic === true,
      detail: "detail" in x && typeof x.detail === "string" ? x.detail : null,
      amountMinor: "amountMinor" in x && typeof x.amountMinor === "number" ? x.amountMinor : null,
      href: "href" in x && typeof x.href === "string" && x.href.startsWith("/") ? x.href : null,
    }];
  });
}

export function WhyNumber({ figure, auditHref }: { figure: "owed"; auditHref?: string }) {
  const [state, setState] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [movers, setMovers] = useState<Mover[]>([]);
  const [error, setError] = useState("");

  async function load() {
    if (state === "loading" || state === "ready") return;
    setState("loading");
    const r = await request<{ movers?: unknown }>(`/api/figure-history?figure=${figure}`);
    if (!r.ok) {
      setError(r.error);
      setState("failed");
      return;
    }
    setMovers(readMovers(r.data.movers));
    setState("ready");
  }

  return (
    <span onClickCapture={() => void load()} onKeyDownCapture={(e) => { if (e.key === "Enter" || e.key === " ") void load(); }}>
      <Popover
        buttonLabel="لماذا هذا الرقم؟"
        buttonClassName="inline-flex min-h-8 items-center gap-1 rounded-md text-[11px] font-bold text-accent hover:underline"
        button={<><CircleHelp className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />لماذا هذا الرقم؟</>}
        width="22rem"
      >
        {() => (
          <div>
            <p className="text-sm font-bold">آخرُ ما حرّكه</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted">من سجلّ التدقيق: ما قُيِّد وما سُدِّد وما صُحِّح — الأحدثُ أوّلاً.</p>
            {state === "loading" && <p className="mt-3 text-xs text-muted" role="status">يُجلَب…</p>}
            {state === "failed" && <p className="mt-3 text-xs font-bold text-danger" role="alert">{error}</p>}
            {state === "ready" && movers.length === 0 && <p className="mt-3 text-xs text-muted">لا قيدَ في السجلّ حرّكه بعد.</p>}
            {state === "ready" && movers.length > 0 && (
              <ul className="mt-3 divide-y divide-line-soft">
                {movers.map((m) => (
                  <li key={m.id} className="py-2 text-xs leading-relaxed">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 font-bold">{m.label}</span>
                      {m.amountMinor !== null && <span className="shrink-0 font-bold"><Money minor={m.amountMinor} /></span>}
                    </span>
                    {m.detail && <span className="block truncate text-ink-soft" dir="auto">{m.detail}</span>}
                    <span className="block text-[11px] text-muted">
                      {m.when} · {m.who}{m.automatic ? " (آليّاً)" : ""}
                      {m.href && <> · <Link href={m.href} className="font-bold text-accent hover:underline">افتحه</Link></>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {auditHref && (
              <Link href={auditHref} className="mt-2 inline-block text-[11px] font-bold text-accent hover:underline">السجلُّ كلُّه</Link>
            )}
          </div>
        )}
      </Popover>
    </span>
  );
}
