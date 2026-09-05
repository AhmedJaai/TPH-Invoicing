"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Money } from "./money";
import { Badge, buttonClass, Card, EmptyState } from "./ui";

/**
 * حلّ المعلّقات — واحدةً واحدة.
 *
 * كانت الشاشة تعرض قوائم منسدلة: صنّف، واختر مورّداً، واحفظ نمطاً.
 * وهذه واجهة إدارة قاعدة بيانات لا واجهة عمل — تطلب من صاحب المقهى أن
 * يفهم كيف يعمل النظام كي يستعمله.
 *
 * وهنا يُسأل سؤالاً واحداً عن حركةٍ واحدة: **ما هذه؟** ثمّ ينتقل. وما
 * يجيبه يصير ذاكرةً تعمّ على أمثاله، فيقصر الطابور من نفسه.
 */

export interface QueueItem {
  id: string;
  date: string;
  amountMinor: number;
  direction: "DEBIT" | "CREDIT";
  description: string;
  beneficiaryRaw: string | null;
  /** ما رجّحه المحرّك، إن رجّح. */
  guessName: string | null;
  guessKind: string | null;
  why: string[];
}

export interface SupplierOption {
  id: string;
  nameAr: string;
}

const KINDS: { value: string; label: string }[] = [
  { value: "SUPPLIER", label: "سداد مورّد" },
  { value: "SALARY", label: "راتب أو أجر" },
  { value: "RENT", label: "إيجار" },
  { value: "UTILITY", label: "كهرباء · مياه · اتصالات" },
  { value: "GOVERNMENT", label: "حكومي · تأمينات · ضريبة" },
  { value: "ZAKAT", label: "زكاة أو صدقة" },
  { value: "PERSONAL", label: "تحويل شخصي" },
  { value: "INTERNAL", label: "تحويل داخلي" },
  { value: "BANK_FEE", label: "رسوم بنكية" },
  { value: "OTHER", label: "أخرى" },
];

export function ReconcileQueue({
  items,
  suppliers,
}: {
  items: readonly QueueItem[];
  suppliers: readonly SupplierOption[];
}) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [kind, setKind] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState<Set<string>>(new Set());

  const remaining = items.filter((i) => !done.has(i.id));
  const item = remaining[Math.min(index, remaining.length - 1)];

  if (!item) {
    return (
      <EmptyState
        title="لا شيء معلّق."
        hint="كل حركة عُرف وجهها. وما يأتي بعدها يُصنَّف تلقائياً ما دام يشبه ما أكّدتَه."
      />
    );
  }

  function next() {
    setDone((d) => new Set(d).add(item!.id));
    setKind(null);
    setSupplierId("");
    setName("");
    setMessage(null);
    setIndex(0);
  }

  async function confirm() {
    if (!kind) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch("/api/counterparty", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          transactionId: item!.id,
          kind,
          supplierId: kind === "SUPPLIER" ? supplierId : null,
          displayName: name.trim() || item!.beneficiaryRaw || undefined,
        }),
      });
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        setFailed(true);
        setMessage(data.error ?? "تعذّر الحفظ");
      } else {
        setMessage(data.message ?? "حُفظت");
        router.refresh();
        next();
      }
    } catch {
      setFailed(true);
      setMessage("تعذّر الاتصال بالخادم");
    } finally {
      setBusy(false);
    }
  }

  const ready = kind !== null && (kind !== "SUPPLIER" || supplierId !== "");

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <p className="text-xs text-muted">
          بقيت <span className="nums font-bold">{remaining.length}</span> من{" "}
          <span className="nums">{items.length}</span>
        </p>
        <button
          type="button"
          onClick={next}
          className="text-[11px] text-muted underline underline-offset-4 hover:text-ink-soft"
        >
          تخطّها الآن
        </button>
      </div>

      <Card>
        <div className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="nums block font-display text-2xl font-bold leading-none">
              {item.direction === "DEBIT" ? "−" : "+"}
              <Money minor={item.amountMinor} />
            </span>
            <span className="nums mt-1.5 block text-[11px] text-muted">{item.date}</span>
          </span>
          {item.guessKind && <Badge tone="warn">ترجيح</Badge>}
        </div>

        <p className="mt-3 text-sm font-bold leading-snug">
          {item.beneficiaryRaw ?? "بلا اسم مستفيد"}
        </p>
        <p className="clamp-2 mt-1 text-[11px] leading-relaxed text-muted">{item.description}</p>

        {item.guessName && (
          <div className="mt-3 rounded-xl border border-line bg-sunken px-3 py-2.5">
            <p className="text-[11px] text-muted">نعتقد أنّها</p>
            <p className="text-sm font-bold">{item.guessName}</p>
            {item.why.length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {item.why.slice(0, 3).map((w, i) => (
                  <li key={i} className="text-[10px] leading-relaxed text-muted">— {w}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* السؤال واحد: ما هذه؟ */}
        <p className="mt-4 text-xs font-bold">ما هذه الحركة؟</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              onClick={() => setKind(k.value)}
              className={`rounded-xl border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                kind === k.value
                  ? "border-ink bg-inverse-surface text-inverse-ink"
                  : "border-line hover:border-ink-soft"
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>

        {/* المورّد لا يُسأل عنه إلّا حين يُختار «سداد مورّد» */}
        {kind === "SUPPLIER" && (
          <label className="mt-3 block">
            <span className="text-[11px] text-muted">أيّ مورّد؟</span>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-ink"
            >
              <option value="">اختر…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.nameAr === "" ? s.id : s.id}>{s.nameAr}</option>
              ))}
            </select>
          </label>
        )}

        {kind !== null && kind !== "SUPPLIER" && (
          <label className="mt-3 block">
            <span className="text-[11px] text-muted">اسم الجهة (اختياريّ)</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              dir="auto"
              placeholder={item.beneficiaryRaw ?? "مثلاً: شركة الكهرباء"}
              className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-ink"
            />
          </label>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!ready || busy}
            onClick={confirm}
            className={buttonClass("primary", "sm")}
          >
            {busy ? "يحفظ…" : "أكّد وانتقل"}
          </button>
          {message && (
            <span className={`text-[11px] ${failed ? "text-danger" : "text-ok"}`}>{message}</span>
          )}
        </div>

        <p className="mt-3 border-t border-line pt-2.5 text-[10px] leading-relaxed text-muted">
          ما تؤكّده هنا يصير ذاكرةً: تُحفَظ أدلّة هذه الجهة — اسمها وحسابها ورقم
          هويّتها — فتُعرَف حركاتها القادمة بلا سؤال.
        </p>
      </Card>
    </div>
  );
}
