/**
 * إصلاحُ جرد السبت الذي بدأه الفريقُ بلا فرع (٨ نوفمبر ٢٠٢٦).
 *
 * جرودُ أحمد كلُّها على «الفرع الرئيسي»، وصفحةُ «الجرد» في TPH Team أنشأت جردَ الأسبوع بلا فرع:
 * فصار سلسلةً وحده — لا جردَ سابق فلا افتتاحيّ ولا متوقَّع، ونطاقُه كلُّ الأصناف. لم يُحذف شيءٌ من
 * جرود أحمد؛ الجردُ الجديد فقط لم يتّصل بها.
 *
 * لكلّ جردٍ مسوّدةٍ بلا فرع بدأه موظّف:
 *   - إن لم يكن لأسبوعه جردٌ على فرع أحمد ← يُنقل إلى فرعه ويُعاد حسابُه (فيرث الافتتاحيَّ والنطاقَ
 *     والمشتريات من جرد أحمد السابق)، ويبقى ما كتبه الموظّفُ كما هو.
 *   - وإن كان لأسبوعه جردٌ عند أحمد ← لا يُمسّ شيء، ويُقال ليُقرَّر بيد.
 * ويُعطي النتيجةَ نفسها إن شُغّل مرّتين: بعد النقل لا يبقى جردٌ بلا فرع.
 *
 *   npx tsx --env-file=.env scripts/fix-team-count-branch.ts                                  ← يعرض الخطّة
 *   npx tsx --env-file=.env scripts/fix-team-count-branch.ts --i-know-this-is-production      ← ينفّذ
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { recordAudit } from "@/lib/audit";
import { recomputeCount } from "@/services/inventory.service";
import { writeAllowed } from "./lib/guard-write";

const WRITE = writeAllowed();

async function main() {
  const [owner] = (await db.execute<{ branch_id: string; name: string | null }>(sql`
    select c.branch_id, b.name_ar as name from inventory_counts c left join branches b on b.id = c.branch_id
     where c.branch_id is not null and c.started_by_employee_id is null
     order by c.period_end desc limit 1
  `)).rows;
  if (!owner) { console.log("لا جرد لأحمد على فرعٍ — لا شيء يُصلَح."); return; }
  const branch = String(owner.branch_id);

  const strays = (await db.execute<{ id: string; period_start: string; period_end: string; status: string; counted: number; total: number }>(sql`
    select c.id, c.period_start, c.period_end, c.status,
           (select count(*)::int from inventory_count_lines l where l.count_id = c.id and l.actual_milli is not null) as counted,
           (select count(*)::int from inventory_count_lines l where l.count_id = c.id) as total
      from inventory_counts c
     where c.branch_id is null and c.started_by_employee_id is not null
     order by c.period_start
  `)).rows;
  console.log(`فرعُ جرود أحمد: ${owner.name ?? branch} (${branch})`);
  if (strays.length === 0) { console.log("لا جردَ بلا فرع بدأه الفريق — لا شيء يُصلَح."); return; }

  for (const s of strays) {
    const label = `جرد ${s.period_start} → ${s.period_end} (${String(s.id).slice(0, 8)}) · ${s.status} · عُدّ ${s.counted} من ${s.total}`;
    if (s.status !== "DRAFT") { console.log(`✕ ${label}: مقفل — لا يُمسّ، يُقرَّر بيد.`); continue; }
    const [clash] = (await db.execute<{ id: string; status: string }>(sql`
      select id, status from inventory_counts where branch_id = ${branch} and period_start = ${s.period_start} and period_end = ${s.period_end}
    `)).rows;
    if (clash) { console.log(`✕ ${label}: لأسبوعه جردٌ عند أحمد (${String(clash.id).slice(0, 8)} · ${clash.status}) — لا يُمسّ، يُقرَّر بيد.`); continue; }

    console.log(`${WRITE ? "←" : "سيُنقل"} ${label} إلى الفرع ويُعاد حسابُه.`);
    if (!WRITE) continue;
    await db.transaction(async (t) => {
      await t.execute(sql`update inventory_counts set branch_id = ${branch} where id = ${s.id} and branch_id is null and status = 'DRAFT'`);
      await recordAudit({
        action: "INVENTORY_COUNT_BRANCH_FIXED",
        entityType: "inventory_count",
        entityId: String(s.id),
        before: { الفرع: "بلا فرع (بدأه TPH Team)" },
        after: { الفرع: owner.name ?? branch, السبب: "إصلاح: جردُ الفريق يدخل سلسلةَ جرود المالك (scripts/fix-team-count-branch.ts)" },
      }, t);
    });
    await recomputeCount(String(s.id));
    const [after] = (await db.execute<{ opening_known: number; in_scope: number; counted: number }>(sql`
      select count(*) filter (where opening_milli is not null)::int as opening_known,
             count(*) filter (where in_scope)::int as in_scope,
             count(*) filter (where actual_milli is not null)::int as counted
        from inventory_count_lines where count_id = ${s.id}
    `)).rows;
    console.log(`   بعده: في النطاق ${after.in_scope} · افتتاحيٌّ معروف ${after.opening_known} · ما عُدّ باقٍ ${after.counted}`);
  }
  if (!WRITE) console.log("\nلم يُكتب شيء. للتنفيذ أعِد الأمر مع --i-know-this-is-production");
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
