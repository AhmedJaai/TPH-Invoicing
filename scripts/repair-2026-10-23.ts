/**
 * موانعُ أقرّ بها أحمد عند الأرشفة وبقيت مفتوحة (٢٣ أكتوبر ٢٠٢٦).
 *
 * ثماني فواتير «أوسكا — المشروبات النقية» اعتُمدت بإقرار «الفاتورة لنا رغم اختلاف رقم المشتري»
 * (`DOCUMENT_BLOCKER_OVERRIDDEN` في التدقيق)، لكنّ التنبيه نفسه كُتب مفتوحاً مانعاً — فمنعت
 * إقفال مايو ويونيو وأغسطس وسبتمبر وأكتوبر بلا اسمٍ ولا رابط. والمسارُ أُصلح في `recordFindings`؛
 * وهذا يكتب للقائم ما يكتبه المسارُ الآن: متجاوَزٌ باسم من أقرّ، ووقتِ إقراره، وسببِه.
 *
 * لا يمسّ مالاً ولا فاتورة: الحكمُ الضريبيّ باقٍ «لا تُخصم». ويُعطي النتيجةَ نفسها إن شُغِّل مرّتين.
 *
 *   npx tsx --env-file=.env scripts/repair-2026-10-23.ts [--i-know-this-is-production]
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { issues } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { OVERRIDABLE_BLOCKERS } from "@/lib/confirm";
import { writeAllowed } from "./lib/guard-write";

const WRITE = writeAllowed();
const REASON = "أقرّ صاحب العمل عند الأرشفة أن الفاتورة له رغم المانع";

async function main() {
  const codes = [...OVERRIDABLE_BLOCKERS];
  const rows = (await db.execute<{ id: string; code: string; message: string; entity_id: string; file_name: string; actor_id: string; at: Date }>(sql`
    select i.id, i.code, i.message, i.entity_id, d.file_name, a.actor_id, a.at
      from issues i
      join documents d on d.id = i.entity_id
      join lateral (
        select a.actor_id, a.at from audit_logs a
         where a.action = 'DOCUMENT_BLOCKER_OVERRIDDEN' and a.entity_id = i.entity_id
         order by a.at limit 1
      ) a on true
     where i.status = 'OPEN' and i.severity = 'BLOCKER' and i.entity_type = 'document'
       and i.code in (${sql.join(codes.map((c) => sql`${c}`), sql`, `)})`)).rows;

  console.log(`موانع مفتوحة لها إقرار مسجّل: ${rows.length}`);
  for (const r of rows) console.log(`  ${r.file_name} · ${r.code}`);
  if (rows.length === 0) { console.log("لا شيء — أُصلحت من قبل."); process.exit(0); }
  if (!WRITE) { console.log("\n(عرضٌ فقط — أضف --i-know-this-is-production للكتابة)"); process.exit(0); }

  await db.transaction(async (t) => {
    for (const r of rows) {
      await t.update(issues).set({ status: "WAIVED", resolvedById: r.actor_id, resolvedAt: new Date(r.at), waiverReason: REASON })
        .where(sql`${issues.id} = ${r.id} and ${issues.status} = 'OPEN'`);
      await recordAudit({
        actorId: r.actor_id, action: "ISSUE_WAIVED", entityType: "document", entityId: r.entity_id,
        before: { التنبيه: r.message, الرمز: r.code, الحال: "مفتوح" },
        after: { الحال: "متجاوَز", السبب: REASON, المصدر: "repair-2026-10-23 — إقرارٌ مسجّل عند الأرشفة لم يُغلق تنبيهه، نفّذه Claude" },
      }, t);
    }
  });
  const [left] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from issues where status = 'OPEN' and severity = 'BLOCKER'`)).rows;
  console.log(`\nتُجووزت ${rows.length}. الموانع المفتوحة الباقية: ${left.n}`);
  process.exit(0);
}
main();
