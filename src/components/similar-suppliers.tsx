"use client";

import { buttonClass } from "./ui-tokens";

/**
 * «أتقصد فلاناً؟» — حين يردّ `/api/supplier` بـ409 و`similar`.
 *
 * الاسمُ الجديد يشبه مسجَّلاً: يُختار المسجَّلُ بضغطة، أو يُنشأ الجديد بإقرارٍ
 * صريح (`confirmNew`). وكان يُنشأ بلا سؤال فينقسم المورّدُ صفَّين.
 */
export interface SimilarSupplier {
  id: string;
  nameAr: string;
  slug?: string;
}

/** يقرأ `similar` من ردّ الخادم بلا افتراض شكله. */
export function readSimilar(data: unknown): SimilarSupplier[] {
  if (typeof data !== "object" || data === null || !("similar" in data) || !Array.isArray(data.similar)) return [];
  const out: SimilarSupplier[] = [];
  for (const x of data.similar) {
    if (typeof x !== "object" || x === null) continue;
    if (!("id" in x) || !("nameAr" in x) || typeof x.id !== "string" || typeof x.nameAr !== "string") continue;
    out.push({ id: x.id, nameAr: x.nameAr, slug: "slug" in x && typeof x.slug === "string" ? x.slug : undefined });
  }
  return out;
}

export function SimilarSuppliers({
  similar,
  busy = false,
  onPick,
  onCreateAnyway,
}: {
  similar: readonly SimilarSupplier[];
  busy?: boolean;
  onPick: (s: SimilarSupplier) => void;
  onCreateAnyway: () => void;
}) {
  if (similar.length === 0) return null;
  return (
    <div role="alert" className="mt-2 rounded-lg border border-warn/40 bg-warn-bg/40 p-2.5">
      <p className="text-[11px] font-bold text-ink">يشبه مورّداً مسجَّلاً — أهو هو؟</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {similar.map((s) => (
          <button key={s.id} type="button" disabled={busy} onClick={() => onPick(s)} className={buttonClass("secondary", "sm")}>
            هو «{s.nameAr}»
          </button>
        ))}
        <button type="button" disabled={busy} aria-busy={busy} onClick={onCreateAnyway} className={buttonClass("quiet", "sm")}>
          لا — أنشئه جديداً
        </button>
      </div>
    </div>
  );
}
