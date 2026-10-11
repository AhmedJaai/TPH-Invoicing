/**
 * مزامنةُ فودكس من الجهاز — للتعبئة الأولى ولما لا يسعه مسارٌ عمرُه ستّون ثانية.
 *
 *   npm run foodics:sync -- --i-know-this-is-production                    ما تغيّر منذ آخر مرّة
 *   npm run foodics:sync -- --from 2026-05-05 --to 2026-10-11 --i-know-this-is-production
 *
 * المدى يُقرأ أسبوعاً أسبوعاً: كلُّ أسبوعٍ استيرادٌ مستقلّ بمعاملته، فإن سقط واحدٌ
 * بقي ما قبله وأُعيد هو وحده. والتشغيلُ مرّتين لا يضاعف شيئاً — المفتاحُ معرّفُ فودكس.
 *
 * قراءةٌ من فودكس وكتابةٌ في قاعدتنا وحدها؛ لا يُكتب في فودكس شيءٌ أبداً.
 */
import { assertWriteAllowed } from "./lib/guard-write";
import { runFoodicsSync } from "@/services/foodics-sync.service";
import { addDays } from "@/lib/riyadh-time";

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

async function main() {
  assertWriteAllowed("مزامنةُ فودكس");
  const from = arg("--from");
  const to = arg("--to");

  if (!from && !to) {
    const r = await runFoodicsSync({ actorId: null });
    console.log(r.status, JSON.stringify(r.counts, null, 1), r.error ?? "");
    process.exit(r.status === "FAILED" ? 1 : 0);
  }
  if (!from || !to || !DAY.test(from) || !DAY.test(to) || from > to) {
    console.error("✕ اكتب المدى كاملاً: --from YYYY-MM-DD --to YYYY-MM-DD");
    process.exit(1);
  }

  let first = true;
  let failed = false;
  for (let start = from; start <= to; start = addDays(start, 7)) {
    const end = [addDays(start, 6), to].sort()[0];
    /* المورّدون والمشتريات والصناديق مرّةً في أوّل أسبوع — هي كاملةٌ في كلّ قراءة */
    const r = await runFoodicsSync({ actorId: null, window: { from: start, to: end }, ordersOnly: !first });
    first = false;
    const c = r.counts;
    console.log(
      `${start} → ${end}  ${r.status}  طلبات ${c.ordersRead} · بيعاتٌ جديدة ${c.salesWritten} · مُعادة ${c.salesRestated} · أسطرٌ روجعت ${c.linesRevised}` +
      (c.purchases ? ` · مشتريات ${c.purchases} · مورّدون ${c.suppliers} · صناديق ${c.tills}` : "") +
      (c.rejected ? ` · مردود ${c.rejected}` : ""),
    );
    for (const p of c.problems.slice(0, 5)) console.log(`   ! ${p}`);
    if (r.error) { console.error(`   ✕ ${r.error}`); failed = true; break; }
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
