"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";
import { BookmarkPlus, X } from "lucide-react";
import { buttonClass } from "./ui-tokens";

/**
 * «عروضي» — ترشيحٌ يُحفَظ باسمٍ على هذا الجهاز ويُفتح بضغطة.
 *
 * المرشِّحاتُ في العنوان فتُشارَك، لكنّ من يفتح كلَّ أسبوع «فواتير هذا الشهر التي
 * لم تُراجَع» كان يعيد اختيار ثلاث قوائم. فالعنوانُ نفسُه يُحفَظ باسم. تخزينُ
 * الجهاز وحده (راحةٌ لا بيانات): إن مُنع بقيت الصفحةُ كما كانت بلا عروض.
 */
interface View { name: string; href: string }

const EVENT = "tph:views";
const MAX = 8;

function read(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "[]";
  } catch {
    return "[]";
  }
}

function parse(raw: string): View[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v)
      ? v.flatMap((x) => (typeof x === "object" && x !== null && "name" in x && "href" in x
          && typeof x.name === "string" && typeof x.href === "string" && x.href.startsWith("/")
          ? [{ name: x.name.slice(0, 40), href: x.href }] : [])).slice(0, MAX)
      : [];
  } catch {
    return [];
  }
}

function write(key: string, views: View[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(views.slice(0, MAX)));
  } catch { /* بلا حفظ */ }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function SavedViews({ scope, suggestedName }: {
  /** مفتاحُ الصفحة — لكلّ صفحةٍ عروضُها. */
  scope: string;
  /** اسمٌ يُقترَح من المرشِّحات القائمة. */
  suggestedName: string;
}) {
  const key = `tph.views.${scope}`;
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = useSyncExternalStore(subscribe, () => read(key), () => "[]");
  const views = useMemo(() => parse(raw), [raw]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  /* رقمُ الصفحة ليس من العرض — يُحفَظ الترشيحُ لا موضعُ القارئ فيه */
  const here = useMemo(() => {
    const p = new URLSearchParams(params.toString());
    p.delete("page");
    const qs = p.toString();
    return `${pathname}${qs ? `?${qs}` : ""}`;
  }, [pathname, params]);
  const filtered = here !== pathname;
  const savedHere = views.some((v) => v.href === here);

  function save() {
    const label = (name.trim() || suggestedName).slice(0, 40);
    write(key, [{ name: label, href: here }, ...views.filter((v) => v.href !== here && v.name !== label)]);
    setNaming(false);
    setName("");
  }

  if (views.length === 0 && !filtered) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {views.length > 0 && <span className="text-[11px] font-bold text-muted">عروضي</span>}
      {views.map((v) => (
        <span
          key={v.href}
          className={`inline-flex min-h-8 items-center rounded-full border text-[12px] ${v.href === here ? "border-accent-line bg-accent-soft text-accent" : "border-line bg-raised text-ink-soft"}`}
        >
          <Link href={v.href} scroll={false} aria-current={v.href === here ? "true" : undefined} className="py-1 ps-3 pe-1 font-bold hover:text-accent">
            {v.name}
          </Link>
          <button
            type="button"
            onClick={() => write(key, views.filter((x) => x.href !== v.href))}
            aria-label={`احذف العرض «${v.name}»`}
            className="grid h-8 w-8 place-items-center rounded-full text-muted hover:text-danger"
          >
            <X className="h-3 w-3" strokeWidth={2.5} aria-hidden />
          </button>
        </span>
      ))}
      {filtered && !savedHere && (naming ? (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => { e.preventDefault(); save(); }}
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setNaming(false); }}
            maxLength={40}
            placeholder={suggestedName}
            aria-label="اسم العرض"
            dir="auto"
            className="min-h-9 w-44 rounded-lg border border-line-input bg-raised px-2.5 text-[13px]"
          />
          <button type="submit" className={buttonClass("primary", "sm")}>احفظ</button>
          <button type="button" onClick={() => setNaming(false)} className={buttonClass("quiet", "sm")}>إلغاء</button>
        </form>
      ) : (
        <button type="button" onClick={() => setNaming(true)} className={buttonClass("quiet", "sm")}>
          <BookmarkPlus className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          احفظ هذا العرض
        </button>
      ))}
    </div>
  );
}
