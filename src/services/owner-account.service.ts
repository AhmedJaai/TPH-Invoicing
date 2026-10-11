/**
 * «بينك وبين المقهى» من القاعدة — دفعاتُ `OWNER_ACCOUNT` القائمة (لا المردودة
 * ولا الملغاة) وحركاتُ البنك المصنَّفة «تحويل شخصيّ» بالاتّجاهين.
 * والحسابُ في `lib/owner-account.ts` الخالصة.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { txHref } from "@/lib/inspector";
import { buildOwnerAccount, type OwnerAccount, type OwnerEntry } from "@/lib/owner-account";

export interface OwnerAccountView extends OwnerAccount {
  /** أوّلُ يومٍ وآخرُه في كشف البنك — ما قبله وما بعده لا يُعرف. */
  bankFirstDay: string | null;
  bankLastDay: string | null;
}

export async function loadOwnerAccount(): Promise<OwnerAccountView> {
  const [paid, moved, span] = await Promise.all([
    db.execute<{ id: string; day: string; amount_minor: number; name: string | null; slug: string | null; raw: string | null }>(sql`
      select p.id, to_char(p.paid_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD') as day,
             p.amount_minor, s.name_ar as name, s.slug, p.beneficiary_name_raw as raw
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
      label: r.name ?? r.raw ?? "دفعةٌ بلا مورّد",
      href: r.slug ? `/suppliers/${r.slug}` : "/suppliers",
    })),
    ...moved.rows.map((r) => ({
      id: `t:${r.id}`,
      day: r.day,
      kind: r.direction === "CREDIT" ? ("PUT_IN" as const) : ("TOOK_OUT" as const),
      amountMinor: Number(r.amount_minor),
      label: r.beneficiary_raw?.trim() || (r.description ?? "").trim().slice(0, 60) || "تحويلٌ شخصيّ",
      href: txHref(r.id),
    })),
  ];

  return {
    ...buildOwnerAccount(entries),
    bankFirstDay: span.rows[0]?.first_day ?? null,
    bankLastDay: span.rows[0]?.last_day ?? null,
  };
}
