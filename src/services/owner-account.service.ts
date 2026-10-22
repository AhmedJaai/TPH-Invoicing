/**
 * «بينك وبين المقهى» من القاعدة — دفعاتُ `OWNER_ACCOUNT` القائمة (لا المردودة
 * ولا الملغاة) وحركاتُ البنك المصنَّفة «تحويل شخصيّ» بالاتّجاهين.
 * والحسابُ في `lib/owner-account.ts` الخالصة.
 */
import { and, eq, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { payments } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { assertMonthsOpen } from "./month-guard";
import { txHref } from "@/lib/inspector";
import { buildOwnerAccount, type OwnerAccount, type OwnerEntry } from "@/lib/owner-account";

export interface OwnerAccountView extends OwnerAccount {
  /** أوّلُ يومٍ وآخرُه في كشف البنك — ما قبله وما بعده لا يُعرف. */
  bankFirstDay: string | null;
  bankLastDay: string | null;
}

export async function loadOwnerAccount(): Promise<OwnerAccountView> {
  const [paid, moved, span] = await Promise.all([
    db.execute<{ id: string; day: string; amount_minor: number; name: string | null; slug: string | null; raw: string | null; from_transfers: boolean }>(sql`
      select p.id, to_char(p.paid_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD') as day,
             p.amount_minor, s.name_ar as name, s.slug, p.beneficiary_name_raw as raw, p.from_owner_transfers as from_transfers
        from payments p left join suppliers s on s.id = p.supplier_id
       where p.method = 'OWNER_ACCOUNT' and p.status not in ('REVERSED', 'VOID')
    `),
    db.execute<{ id: string; day: string; amount_minor: number; direction: string; beneficiary_raw: string | null; description: string | null }>(sql`
      select id, to_char(value_date at time zone 'Asia/Riyadh', 'YYYY-MM-DD') as day,
             amount_minor, direction::text as direction, beneficiary_raw, description
        from bank_transactions
       where category = 'PERSONAL'
    `),
    db.execute<{ first_day: string | null; last_day: string | null }>(sql`
      select to_char(min(value_date at time zone 'Asia/Riyadh'), 'YYYY-MM-DD') as first_day,
             to_char(max(value_date at time zone 'Asia/Riyadh'), 'YYYY-MM-DD') as last_day
        from bank_transactions
    `),
  ]);

  const entries: OwnerEntry[] = [
    ...paid.rows.map((r) => ({
      id: `p:${r.id}`,
      day: r.day,
      kind: "PAID_FOR_CAFE" as const,
      amountMinor: Number(r.amount_minor),
      label: r.name ?? r.raw ?? "دفعة بلا مورّد",
      href: r.slug ? `/suppliers/${r.slug}` : "/suppliers",
      payment: { id: r.id, fromTransfers: Boolean(r.from_transfers) },
    })),
    ...moved.rows.map((r) => ({
      id: `t:${r.id}`,
      day: r.day,
      kind: r.direction === "CREDIT" ? ("PUT_IN" as const) : ("TOOK_OUT" as const),
      amountMinor: Number(r.amount_minor),
      label: r.beneficiary_raw?.trim() || (r.description ?? "").trim().slice(0, 60) || "تحويل شخصيّ",
      href: txHref(r.id),
    })),
  ];

  return {
    ...buildOwnerAccount(entries),
    bankFirstDay: span.rows[0]?.first_day ?? null,
    bankLastDay: span.rows[0]?.last_day ?? null,
  };
}

/**
 * سدادٌ من مال المالك: أمِن تحويلات المقهى إليه (يُخصم منها في قائمة الدخل) أم من ماله
 * الخاصّ (لا يُخصم)؟ يقرّره المالكُ لكلّ سدادٍ بعينه (083) — ولا يُفترض عنه شيء.
 * والشهرُ المقفل لا يُغيَّر فيه شيء من أيّ باب.
 *
 * `false`: لا سدادَ قائمٌ من مال المالك بهذا المعرّف.
 */
export async function setOwnerPaymentSource(paymentId: string, fromTransfers: boolean, actorId: string): Promise<boolean> {
  return db.transaction(async (t) => {
    const [row] = await t
      .select({ id: payments.id, month: sql<string>`to_char(${payments.paidAt} at time zone 'Asia/Riyadh', 'YYYY-MM')`, before: payments.fromOwnerTransfers, amountMinor: payments.amountMinor })
      .from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.method, "OWNER_ACCOUNT"), notInArray(payments.status, ["REVERSED", "VOID"])))
      .limit(1);
    if (!row) return false;
    if (row.before === fromTransfers) return true;
    await assertMonthsOpen(t, [row.month]);
    await t.update(payments).set({ fromOwnerTransfers: fromTransfers }).where(eq(payments.id, paymentId));
    await recordAudit({
      actorId,
      action: "OWNER_PAYMENT_SOURCE_SET",
      entityType: "payment",
      entityId: paymentId,
      before: { المصدر: row.before ? "من تحويلات المقهى" : "من مال المالك الخاص" },
      after: { المصدر: fromTransfers ? "من تحويلات المقهى" : "من مال المالك الخاص", المبلغ_بالهللات: row.amountMinor },
    }, t);
    return true;
  });
}
