"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui";
import { Money } from "./money";

/**
 * شاشةُ العدّ الأسبوعيّ — خانةٌ واحدة لكلّ صنف.
 *
 * ── ما تُحسّنه ──
 *
 * صاحبُ المقهى يقف عند الرفّ ومعه ميزان، ويكتب رقماً ثمّ ينتقل. فكلُّ
 * ما عدا **خانة الفعليّ** محسوبٌ ومعروض، والتنقّل بـEnter لا بالفأرة،
 * وارتفاعُ اللمس ٤٤ بكسلاً لأنّه يضغط بإبهامه.
 *
 * ── والحفظُ لا يقع بالمصادفة ──
 *
 * يُحفَظ **ما تغيّر وحده** عند الضغط. والمسوّدةُ تبقى مسوّدة: يخرج
 * ويعود فيجد ما أدخله. والإقفالُ فعلٌ آخر في مكانٍ آخر.
 *
 * ── ويُعَدّ بالوحدة التي يُوزَن بها ──
 *
 * وحدةُ الصنف في الكتالوج هي وحدةُ **صرفه** — البنُّ بالجرام لأنّ
 * الوصفة تقول «٢٠ جراماً». وصاحبُ المقهى يزن الكيسَ فيقرأ «٥٫٢ كجم»،
 * فلو لزمته الوحدةُ الصغرى لكتب «٥٢٠٠» وأخطأ في صفرٍ لا يُرى أثرُه
 * إلّا في فرقٍ بعشرة أضعاف.
 *
 * فتُعرَض له وحدتا عائلته، ويختار. **والتحويلُ في الخادم** لا هنا:
 * يصل الرقمُ ووحدتُه، ويُحوَّل هناك — فلا يُصدَّق المتصفّح في رقمٍ
 * يُبنى عليه قرار.
 *
 * ── ولا يُحسَب فرقٌ في المتصفّح يُعتمَد عليه ──
 *
 * الفرقُ المعروض أثناء الكتابة **مؤشِّرٌ فوريّ** لا رقمٌ يُحفَظ. والرقمُ
 * الذي يدخل التقرير يحسبه الخادم بعد الحفظ ويُعيده. والدرسُ من
 * `confirm.ts`: لا يُصدَّق المتصفّح في رقمٍ يُبنى عليه قرار.
 */

export interface CountRow {
  productId: string;
  productName: string;
  category: string;
  categoryLabel: string;
  unitLabel: string;
  /** وحدةُ الصنف كما تُخزَّن — يُرسَل ما يختاره ويُحوَّل في الخادم. */
  baseUnit: string;
  /** وحدتا عائلته بأسمائهما — واحدةٌ فقط لما لا أكبرَ له. */
  unitChoices: { value: string; label: string }[];
  /** المتوقَّع بوحدة الصنف — نصّاً كما يُعرَض، أو `null` «غير معروف». */
  expected: string | null;
  /** ما أُدخل سابقاً بوحدة الصنف، نصّاً. */
  actual: string;
  varianceText: string | null;
  varianceBpText: string | null;
  varianceCostMinor: number | null;
  /** أسبابٌ تُقرأ — لماذا جُهل ما جُهل. */
  flags: string[];
  negative: boolean;
}

export function InventoryCountEntry({
  countId,
  rows,
  categories,
  canEdit,
  locked,
}: {
  countId: string;
  rows: CountRow[];
  categories: { key: string; label: string }[];
  canEdit: boolean;
  locked: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(
    () => Object.fromEntries(rows.map((r) => [r.productId, r.actual])),
  );
  /* الوحدةُ المختارة لكلّ صنف — وأوّلُها وحدتُه في الكتالوج */
  const [units, setUnits] = useState<Record<string, string>>(
    () => Object.fromEntries(rows.map((r) => [r.productId, r.baseUnit])),
  );
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [onlyUncounted, setOnlyUncounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  const initial = useMemo(
    () => Object.fromEntries(rows.map((r) => [r.productId, r.actual])),
    [rows],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (category && r.category !== category) return false;
      if (onlyUncounted && (values[r.productId] ?? "").trim() !== "") return false;
      if (q && !r.productName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, query, category, onlyUncounted, values]);

  const dirty = rows.filter((r) => (values[r.productId] ?? "") !== (initial[r.productId] ?? ""));
  const counted = rows.filter((r) => (values[r.productId] ?? "").trim() !== "").length;

  async function save() {
    if (dirty.length === 0) return;
    setBusy(true);
    setFailed(false);
    setMessage(null);

    const r = await postJson("/api/inventory/count", {
      action: "save",
      countId,
      entries: dirty.map((row) => ({
        productId: row.productId,
        actual: (values[row.productId] ?? "").trim() === "" ? null : values[row.productId].trim(),
        /* الوحدةُ تُرسَل مع الرقم، والتحويلُ في الخادم */
        unit: units[row.productId] ?? row.baseUnit,
      })),
    });

    setBusy(false);
    if (!r.ok) {
      setFailed(true);
      setMessage(r.error);
      return;
    }
    setMessage(String(r.data.message ?? "حُفظ."));
    router.refresh();
  }

  /** Enter ينتقل إلى الصنف التالي — لا يرسل نموذجاً ولا يُغلق شيئاً. */
  function onKey(e: React.KeyboardEvent<HTMLInputElement>, at: number) {
    if (e.key === "Enter" || (e.key === "ArrowDown" && !e.shiftKey)) {
      e.preventDefault();
      inputs.current[at + 1]?.focus();
      inputs.current[at + 1]?.select();
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      inputs.current[at - 1]?.focus();
      inputs.current[at - 1]?.select();
    }
  }

  return (
    <div>
      <div className="sticky top-0 z-10 -mx-1 mb-3 flex flex-wrap items-center gap-2 bg-canvas/95 px-1 py-2 backdrop-blur">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ابحث عن صنف…"
          aria-label="ابحث عن صنف"
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-raised px-3 text-sm"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="رشِّح بالباب"
          className="min-h-11 rounded-xl border border-line bg-raised px-3 text-xs"
        >
          <option value="">كلّ الأبواب</option>
          {categories.map((c) => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-line px-3 text-xs">
          <input
            type="checkbox"
            checked={onlyUncounted}
            onChange={(e) => setOnlyUncounted(e.target.checked)}
            className="h-4 w-4 accent-[var(--ink)]"
          />
          ما لم يُعَدّ بعد
        </label>
        <span className="nums text-xs text-muted">
          {counted} / {rows.length}
        </span>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line px-5 py-10 text-center text-sm text-muted">
          لا صنفَ يطابق هذا الترشيح.
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-raised">
          {visible.map((row, at) => {
            const value = values[row.productId] ?? "";
            const changed = value !== (initial[row.productId] ?? "");
            return (
              <li key={row.productId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-bold">{row.productName}</p>
                  <p className="text-[11px] text-muted">
                    المتوقَّع:{" "}
                    <span className={row.expected ? "nums" : ""}>{row.expected ?? "غير معروف"}</span>
                    {row.flags.length > 0 && (
                      <span className="text-warn"> · {row.flags[0]}</span>
                    )}
                  </p>
                </div>

                <label className="flex shrink-0 items-center gap-1.5">
                  <span className="sr-only">{`العدّ الفعليّ لـ${row.productName} بـ${row.unitLabel}`}</span>
                  <input
                    ref={(el) => { inputs.current[at] = el; }}
                    type="text"
                    inputMode="decimal"
                    dir="ltr"
                    disabled={!canEdit || locked || busy}
                    value={value}
                    onChange={(e) => setValues((v) => ({ ...v, [row.productId]: e.target.value }))}
                    onKeyDown={(e) => onKey(e, at)}
                    placeholder="—"
                    className={`nums min-h-11 w-24 rounded-xl border px-2 text-center text-sm ${
                      changed ? "border-ok bg-ok-bg" : "border-line bg-canvas"
                    }`}
                  />
                  {row.unitChoices.length > 1 ? (
                    <select
                      aria-label={`وحدةُ عدّ ${row.productName}`}
                      disabled={!canEdit || locked || busy}
                      value={units[row.productId] ?? row.baseUnit}
                      onChange={(e) => setUnits((u) => ({ ...u, [row.productId]: e.target.value }))}
                      className="min-h-11 w-16 rounded-xl border border-line bg-canvas px-1 text-[11px]"
                    >
                      {row.unitChoices.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="w-12 text-[11px] text-muted">{row.unitLabel}</span>
                  )}
                </label>

                <div className="w-28 shrink-0 text-end">
                  {row.varianceText ? (
                    <>
                      <p className={`nums text-xs font-bold ${row.negative ? "text-danger" : "text-ok"}`}>
                        {row.varianceText}
                      </p>
                      <p className="nums text-[11px] text-muted">
                        {row.varianceBpText}
                        {row.varianceCostMinor !== null && (
                          <> · <Money minor={row.varianceCostMinor} /></>
                        )}
                      </p>
                    </>
                  ) : (
                    <p className="text-[11px] text-muted">—</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {canEdit && !locked && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={busy || dirty.length === 0}
            className={buttonClass("primary")}
          >
            {busy ? "يُحفظ…" : dirty.length === 0 ? "لا تغييرَ يُحفظ" : `احفظ ${dirty.length} صنفاً`}
          </button>
          <span className="text-[11px] text-muted">
            المسوّدةُ تبقى — اخرج وعُد فتجد ما أدخلته. والإقفالُ فعلٌ مستقلّ.
          </span>
          {message && (
            <span className={`text-xs ${failed ? "text-danger" : "text-ok"}`}>{message}</span>
          )}
        </div>
      )}
    </div>
  );
}
