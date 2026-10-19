/**
 * جوابُ السؤال بالكلمات — الرقمُ من القاعدة، بالقواعد القائمة نفسها:
 *
 *   - «دفعتُ»: ما خرج فعلاً للمورّد — الدفعاتُ القائمة ناقص رسومها، بلا الإشعارات
 *     الدائنة وبلا الملغى والمردود (تعريفُ `paidNetMinor` في `supplier-balance.service`).
 *   - «اشتريتُ»: مجموعُ فواتيره بشهرها المحاسبيّ.
 *   - «عليّ»: `owedMinor` من مصدر «كم أدين؟» الواحد — والشهرُ لا معنى له فيه.
 *
 * ومورّدٌ لم يُعرف أو احتمل اثنين لا يُجاب عنه برقم.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { invoices, payments, supplierAliases, suppliers } from "@/db/schema";
import { resolveAskedSupplier, type Question } from "@/lib/ask";
import { formatMonth } from "@/lib/riyadh-time";
import { loadSupplierBalances } from "./supplier-balance.service";

export type Answer =
  | { state: "ANSWER"; label: string; amountMinor: number; basis: string; href: string }
  | { state: "AMBIGUOUS"; names: string[] }
  | { state: "UNKNOWN_SUPPLIER"; text: string };

export async function answerQuestion(q: Question): Promise<Answer> {
  const [rows, aliases] = await Promise.all([
    db.select({ id: suppliers.id, nameAr: suppliers.nameAr, nameEn: suppliers.nameEn, slug: suppliers.slug }).from(suppliers),
    /* صيغُ الاسم وحدها — اسمُ المستفيد في البنك قد يكون اسمَ شخصٍ يحتمل غيرَه */
    db.select({ supplierId: supplierAliases.supplierId, alias: supplierAliases.value }).from(supplierAliases)
      .where(eq(supplierAliases.kind, "NAME_VARIANT")),
  ]);
  const found = resolveAskedSupplier(
    rows.map((s) => ({
      ...s,
      names: [s.nameAr, s.nameEn ?? "", ...aliases.filter((a) => a.supplierId === s.id).map((a) => a.alias)].filter(Boolean),
    })),
    q.supplierText,
  );
  if (found.length === 0) return { state: "UNKNOWN_SUPPLIER", text: q.supplierText };
  if (found.length > 1) return { state: "AMBIGUOUS", names: found.slice(0, 5).map((s) => s.nameAr) };
  const supplier = found[0];
  const when = q.month ? `في ${formatMonth(q.month)}` : "منذ البداية";

  if (q.kind === "OWED") {
    const balance = (await loadSupplierBalances()).find((b) => b.supplierId === supplier.id);
    return {
      state: "ANSWER",
      label: `عليك لـ${supplier.nameAr} الآن`,
      amountMinor: balance?.owedMinor ?? 0,
      basis: balance ? "الفواتير المفتوحة بعد خصم ما دفعته ولم يُوزَّع على فواتير" : "لا فواتير مفتوحة ولا دفعات لهذا المورّد",
      href: `/suppliers/${supplier.slug}`,
    };
  }

  if (q.kind === "PAID") {
    const [row] = await db
      .select({ sum: sql<string>`coalesce(sum(${payments.amountMinor} - ${payments.feeMinor}), 0)::bigint`, n: sql<number>`count(*)::int` })
      .from(payments)
      .where(and(
        eq(payments.supplierId, supplier.id),
        sql`${payments.status} not in ('REVERSED', 'VOID')`,
        sql`${payments.method} <> 'CREDIT_NOTE'`,
        q.month ? sql`to_char(${payments.paidAt} at time zone 'Asia/Riyadh', 'YYYY-MM') = ${q.month}` : undefined,
      ));
    return {
      state: "ANSWER",
      label: `دفعت لـ${supplier.nameAr} ${when}`,
      amountMinor: Number(row?.sum ?? 0),
      basis: `${row?.n ?? 0} دفعة سارية، دون الإشعارات الدائنة والدفعات الملغاة`,
      href: `/suppliers/${supplier.slug}?tab=payments#detail`,
    };
  }

  const [row] = await db
    .select({ sum: sql<string>`coalesce(sum(${invoices.totalMinor}), 0)::bigint`, n: sql<number>`count(*)::int` })
    .from(invoices)
    .where(and(eq(invoices.supplierId, supplier.id), q.month ? eq(invoices.periodMonth, q.month) : undefined));
  return {
    state: "ANSWER",
    label: `اشتريت من ${supplier.nameAr} ${when}`,
    amountMinor: Number(row?.sum ?? 0),
    basis: `${row?.n ?? 0} فاتورة مسجّلة في شهرها المحاسبي، شاملة الضريبة`,
    href: `/suppliers/${supplier.slug}?tab=invoices#detail`,
  };
}
