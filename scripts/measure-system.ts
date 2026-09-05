/**
 * مقاييس النظام — هل يتحسّن أم يسوء؟
 *
 *   npm run db:measure
 *
 * لا يعدّل شيئاً. يقرأ ما فعله الإنسان — أقرّ، أو ردّ، أو تراجع — ويحسب
 * عليه. وما لم يمرّ بإنسانٍ لا يُحسَب صواباً ولا خطأً.
 *
 * والحساب في `lib/bank/metrics.ts` دوالَّ خالصة؛ وهذا يجلب أرقامه.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  RECALL_NOTE, computeMetrics, formatMetric, healthOf,
  type Health, type OutcomeCounts,
} from "@/lib/bank/metrics";

const MARK: Record<Health, string> = {
  GOOD: "✓", WATCH: "…", BAD: "✕", UNKNOWN: "؟",
};

async function main() {
  const [row] = (
    await db.execute<Record<string, number>>(sql`
      select
        (select count(*)::int from bank_transactions
          where match_disposition = 'AUTO')                                   as auto,
        (select count(*)::int from bank_transactions
          where match_disposition = 'SUGGEST')                                as suggested,
        (select count(*)::int from bank_transactions
          where match_disposition = 'REVIEW')                                 as review,

        /* الحقيقة الأرضيّة الوحيدة: ما فعله إنسان، من تاريخ القرار */
        (select count(distinct bank_transaction_id)::int from decision_history
          where event = 'MATCH_CONFIRMED' and actor = 'HUMAN')                as confirmed_by_human,
        (select count(distinct bank_transaction_id)::int from decision_history
          where event = 'MATCH_REJECTED'  and actor = 'HUMAN')                as rejected_by_human,

        /*
          خطأ الحسم التلقائيّ: ما كُتب بلا إنسان ثمّ تُراجِع عنه.
          ويُشترَط أن يسبقه حسمٌ تلقائيّ — والتراجع عن اقتراحٍ أقرّه
          إنسان خطأُ الإنسان لا خطأُ النظام.
        */
        (select count(distinct h.bank_transaction_id)::int
           from decision_history h
          where h.event = 'MATCH_REVERSED'
            and not exists (
              select 1 from decision_history c
               where c.bank_transaction_id = h.bank_transaction_id
                 and c.event = 'MATCH_CONFIRMED' and c.actor = 'HUMAN'
            ))                                                                as auto_reversed,

        /* ما دخل المطابقة أصلاً: الصادر الذي يُحتمَل أنّه سداد */
        (select count(*)::int from bank_transactions
          where direction = 'DEBIT'
            and category in ('SUPPLIER', 'UNKNOWN'))                          as total_candidates
    `)
  ).rows;

  const counts: OutcomeCounts = {
    auto: Number(row?.auto ?? 0),
    suggested: Number(row?.suggested ?? 0),
    review: Number(row?.review ?? 0),
    confirmedByHuman: Number(row?.confirmed_by_human ?? 0),
    rejectedByHuman: Number(row?.rejected_by_human ?? 0),
    autoReversed: Number(row?.auto_reversed ?? 0),
    totalCandidatesForMatching: Number(row?.total_candidates ?? 0),
  };

  console.log("\n═══════════ مقاييس النظام ═══════════\n");

  for (const m of computeMetrics(counts)) {
    console.log(`  ${MARK[healthOf(m)]} ${m.label}: ${formatMetric(m)}`);
    console.log(`     ${m.meaning}\n`);
  }

  console.log("───────────────────────────────────\n");
  console.log(`  ${RECALL_NOTE}\n`);

  const unresolved = (
    await db.execute<{ n: number }>(sql`
      select count(*)::int as n from bank_transactions
      where lifecycle in ('RAW', 'INFERRED', 'SUGGESTED')
    `)
  ).rows[0];

  console.log(`  ما لم يبلغ قراراً بعد: ${Number(unresolved?.n ?? 0)} حركة`);
  console.log("  (وهذا عملٌ لم يُنجَز — لا خطأٌ في النظام)\n");

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
