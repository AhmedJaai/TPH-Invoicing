"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { GitMerge, Trash2, Undo2 } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { formatMonth } from "@/lib/riyadh-time";
import { MERGE_TABLES, MERGE_TABLE_LABEL, type DeletePreview, type MergePreview } from "@/lib/supplier-merge";
import { Money } from "./money";
import { buttonClass } from "./ui-tokens";
import { T } from "./i18n/t";

/**
 * إجراءاتُ المالك على المورّد: «دمج في مورّدٍ آخر» و«حذف المورّد» — وعلى المدموج «تراجع».
 *
 * لا شيء يُكتب قبل المعاينة: الخادمُ يقول ما ينتقل من كلّ جدول، وما يتعارض، و«عليك» قبل
 * وبعد، والأشهرَ المقفلة إن مسّها. ثمّ «أكّد». والتعارضُ يلزمه إقرارٌ صريح.
 */
export function SupplierOwnerActions({
  supplierId,
  supplierName,
  targets,
  initialTargetId = null,
  mergedInto = null,
}: {
  supplierId: string;
  supplierName: string;
  targets: readonly { id: string; name: string }[];
  /** من «ادمج» في تلميح التكرار — تُفتح المعاينةُ مباشرة */
  initialTargetId?: string | null;
  mergedInto?: { name: string; slug: string } | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "merge" | "delete">(initialTargetId ? "merge" : "idle");
  const [targetId, setTargetId] = useState(initialTargetId ?? "");
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [delPreview, setDelPreview] = useState<DeletePreview | null>(null);
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(Boolean(initialTargetId));
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function loadMergePreview(id: string) {
    setPreview(null); setError(null); setAccept(false);
    if (!id) return;
    setBusy(true);
    const r = await postJson<{ preview: MergePreview }>("/api/supplier-merge", { action: "preview-merge", sourceId: supplierId, targetId: id });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setPreview(r.data.preview);
  }

  useEffect(() => {
    /* تُفتح مرّةً من الرابط — والحالُ تُكتب حين يصل الجواب لا في جسم الأثر */
    if (!initialTargetId) return;
    let live = true;
    void postJson<{ preview: MergePreview }>("/api/supplier-merge", { action: "preview-merge", sourceId: supplierId, targetId: initialTargetId })
      .then((r) => {
        if (!live) return;
        setBusy(false);
        if (r.ok) setPreview(r.data.preview); else setError(r.error);
      });
    return () => { live = false; };
  }, [initialTargetId, supplierId]);

  async function merge() {
    if (!preview) return;
    setBusy(true); setError(null);
    const r = await postJson<{ message: string; targetSlug: string }>("/api/supplier-merge", {
      action: "merge", sourceId: supplierId, targetId: preview.target.id, acceptConflicts: accept,
    });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setDone(r.data.message);
    router.push(`/suppliers/${r.data.targetSlug}`);
  }

  async function loadDeletePreview() {
    setMode("delete"); setDelPreview(null); setError(null);
    setBusy(true);
    const r = await postJson<{ preview: DeletePreview }>("/api/supplier-merge", { action: "preview-delete", supplierId });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setDelPreview(r.data.preview);
  }

  async function remove() {
    setBusy(true); setError(null);
    const r = await postJson<{ message: string }>("/api/supplier-merge", { action: "delete", supplierId });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setDone(r.data.message);
    router.push("/suppliers");
  }

  async function undo() {
    setBusy(true); setError(null);
    const r = await postJson<{ message: string }>("/api/supplier-merge", { action: "undo", sourceId: supplierId });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setDone(r.data.message);
    router.refresh();
  }

  const status = (
    <>
      {error && <p role="alert" className="mt-3 text-xs font-bold text-danger">{error}</p>}
      {done && <p role="status" className="mt-3 text-xs font-bold text-ok">{done}</p>}
    </>
  );

  if (mergedInto) {
    return (
      <div id="owner-actions" className="rounded-2xl border border-line bg-raised p-4 shadow-raised sm:p-5">
        <h3 className="text-sm font-bold"><T s="دُمج هذا المورّد في «{0}»" a={[mergedInto.name]} /></h3>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          <T s="فواتيره ودفعاته وحركاته صارت عند «{0}»، وهذه الصفحة شاهد على ما كان. التراجع يعيد إليه ما نُقل منه بمعرّفاته، وما أُضيف بعد الدمج يبقى حيث هو." a={[mergedInto.name]} />
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href={`/suppliers/${mergedInto.slug}`} className={buttonClass("secondary", "sm")}><T s="افتح «{0}»" a={[mergedInto.name]} /></a>
          <button type="button" disabled={busy} onClick={undo} className={buttonClass("quiet", "sm")}>
            <Undo2 className="h-4 w-4" aria-hidden /> تراجع عن الدمج
          </button>
        </div>
        {status}
      </div>
    );
  }

  return (
    <div id="owner-actions" className="rounded-2xl border border-line bg-raised p-4 shadow-raised sm:p-5">
      <h3 className="text-sm font-bold">إجراءات المالك</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        لمورّد سُجّل مرتين، أو اسم سُجّل مورّداً خطأً. لا يُكتب شيء قبل أن ترى ما سيتغير وتؤكده.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => { setMode("merge"); setDelPreview(null); setError(null); }} className={buttonClass(mode === "merge" ? "secondary" : "quiet", "sm")}>
          <GitMerge className="h-4 w-4" aria-hidden /> دمج في مورّد آخر
        </button>
        <button type="button" disabled={busy} onClick={loadDeletePreview} className={buttonClass(mode === "delete" ? "secondary" : "quiet", "sm")}>
          <Trash2 className="h-4 w-4" aria-hidden /> حذف المورّد
        </button>
      </div>

      {mode === "merge" && (
        <div className="mt-4 space-y-3">
          <label className="block text-xs font-bold">
            <T s="ادمج «{0}» في:" a={[supplierName]} />
            <select
              value={targetId}
              disabled={busy}
              onChange={(e) => { setTargetId(e.target.value); void loadMergePreview(e.target.value); }}
              className="mt-1 block min-h-11 w-full rounded-lg border border-line-input bg-raised px-3 text-sm sm:min-h-9"
            >
              <option value="">اختر المورّد الباقي</option>
              {targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          {busy && !preview && <p className="text-xs text-muted" role="status">يُحسب ما سينتقل…</p>}
          {preview && <MergePreviewView p={preview} accept={accept} setAccept={setAccept} />}
          {preview && !preview.refused && preview.closedMonths.length === 0 && (
            <button
              type="button"
              disabled={busy || (preview.conflicts.length > 0 && !accept)}
              onClick={merge}
              className={buttonClass("primary", "sm")}
            >
              <T s="أكّد الدمج في «{0}»" a={[preview.target.name]} />
            </button>
          )}
        </div>
      )}

      {mode === "delete" && (
        <div className="mt-4 space-y-3">
          {busy && !delPreview && <p className="text-xs text-muted" role="status">يُفحص ما عليه…</p>}
          {delPreview && <DeletePreviewView p={delPreview} />}
          {delPreview && !delPreview.refused && (
            <button type="button" disabled={busy} onClick={remove} className={buttonClass("danger", "sm")}>
              <T s="أكّد حذف «{0}»" a={[delPreview.supplier.name]} />
            </button>
          )}
        </div>
      )}
      {status}
    </div>
  );
}

function MergePreviewView({ p, accept, setAccept }: { p: MergePreview; accept: boolean; setAccept: (v: boolean) => void }) {
  if (p.refused) return <p role="alert" className="text-xs font-bold text-danger">{p.refused}</p>;
  const moving = MERGE_TABLES.filter((t) => p.counts[t] > 0);
  return (
    <div className="space-y-3 rounded-xl border border-line bg-sunken p-3 text-xs leading-relaxed">
      {p.closedMonths.length > 0 && (
        <p role="alert" className="font-bold text-danger">
          <T s="الدمج يمسّ أشهراً مقفلة: {0}. أعد فتحها من صفحة الإقفال أولاً، أو اترك المورّدين كما هما." a={[p.closedMonths.map(formatMonth).join("، ")]} />
        </p>
      )}
      <div>
        <p className="font-bold"><T s="ما سينتقل من «{0}» إلى «{1}»" a={[p.source.name, p.target.name]} /></p>
        {moving.length === 0
          ? <p className="mt-1 text-muted">لا شيء يشير إليه. سيبقى صفاً معطّلاً مدموجاً.</p>
          : (
            <ul className="mt-1 grid grid-cols-[minmax(0,1fr)] gap-x-4 sm:grid-cols-2">
              {moving.map((t) => (
                <li key={t} className="flex justify-between gap-2 border-b border-line/60 py-1">
                  <span>{MERGE_TABLE_LABEL[t]}</span><span className="nums font-bold">{p.counts[t]}</span>
                </li>
              ))}
            </ul>
          )}
        {(p.duplicates.aliases + p.duplicates.products + p.duplicates.itemAliases) > 0 && (
          <p className="mt-2 text-muted">
            <T s="ويحمل «{0}» مثلها فلا تُنقل وتُحذف من المدموج (وتُحفظ للتراجع): أسماء بديلة {1} · أصناف {2} (تُنسب بنودها إلى صنفه) · صيغ أصناف {3}." a={[p.target.name, <span key="1" className="nums">{p.duplicates.aliases}</span>, <span key="2" className="nums">{p.duplicates.products}</span>, <span key="3" className="nums">{p.duplicates.itemAliases}</span>]} />
          </p>
        )}
      </div>
      <div>
        <p className="font-bold">المستحق عليك</p>
        <ul className="mt-1 space-y-0.5">
          <li><T s="لـ«{0}» قبل الدمج: {1}" a={[p.source.name, <Money key="1" minor={p.balance.source} currency />]} /></li>
          <li><T s="لـ«{0}» قبل الدمج: {1}" a={[p.target.name, <Money key="1" minor={p.balance.target} currency />]} /></li>
          <li className="font-bold"><T s="لـ«{0}» بعد الدمج: {1}" a={[p.target.name, <Money key="1" minor={p.balance.after} currency />]} />{p.balance.creditAfter > 0 && <> · <T s="ولك عنده {0}" a={[<Money key="0" minor={p.balance.creditAfter} currency />]} /></>}</li>
        </ul>
      </div>
      {(p.copies.vatNumber || p.copies.iban) && (
        <p className="text-muted">
          <T s="يُنقل إلى «{0}» لأنه يخلو منه: {1}." a={[p.target.name, <bdi key="1" dir="ltr">{[p.copies.vatNumber, p.copies.iban].filter(Boolean).join(" · ")}</bdi>]} />
        </p>
      )}
      {p.conflicts.length > 0 && (
        <div className="rounded-lg border border-warn/40 bg-warn-bg p-2.5">
          {p.conflicts.map((c) => (
            <p key={c.field} className="text-warn">
              <strong>{c.label}.</strong> <bdi dir="ltr">{c.source}</bdi> ← <bdi dir="ltr">{c.target}</bdi>
            </p>
          ))}
          <label className="mt-2 flex items-start gap-2 font-bold">
            <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} className="mt-0.5" />
            أعرف أنهما مورّد واحد رغم هذا الاختلاف
          </label>
        </div>
      )}
    </div>
  );
}

function DeletePreviewView({ p }: { p: DeletePreview }) {
  if (p.refused) return <p role="alert" className="text-xs font-bold text-danger">{p.refused}</p>;
  const d = p.detach;
  const items: [string, number][] = ([
    ["مستندات تبقى في الأرشيف بلا مورّد", d.documents],
    ["أسماء بديلة تُحذف (فلا تُنسب إليه حوالة بعدها)", d.aliases],
    ["أصناف تُحذف", d.products],
    ["صيغ أسماء أصناف تُحذف", d.itemAliases],
    ["جهات في كشف البنك تعود «غير مصنّفة» فتُسأل عنها", d.counterparties],
    ["قواعد تصنيف باسمه تُحذف", d.rules],
    ["مورّدو فودكس يُفكّ ربطهم", d.foodics],
    ["ملاحظات تحليل تُحذف", d.findings],
  ] as [string, number][]).filter(([, n]) => n > 0);
  return (
    <div className="space-y-2 rounded-xl border border-line bg-sunken p-3 text-xs leading-relaxed">
      <p className="font-bold"><T s="لا مال مقيَّد على «{0}»: لا فواتير ولا دفعات ولا كشوف ولا حركات بنك." a={[p.supplier.name]} /></p>
      {items.length === 0
        ? <p className="text-muted">ولا شيء آخر يشير إليه.</p>
        : <ul className="list-disc space-y-0.5 ps-5">{items.map(([label, n]) => <li key={label}>{label}: <span className="nums font-bold">{n}</span></li>)}</ul>}
      <p className="text-muted">لا يُمسّ ملف في جوجل درايف، ويُحفظ ما حُذف في سجل التدقيق.</p>
    </div>
  );
}
