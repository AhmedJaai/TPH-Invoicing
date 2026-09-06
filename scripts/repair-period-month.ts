/**
 * إصلاح الشهر المحاسبيّ لما حُفظ بشهر رفعه.
 *
 *   npm run db:repair-months            # معاينة — لا يكتب شيئاً
 *   npm run db:repair-months -- --apply # يكتب
 *
 * والسبب: `/api/archive` كان يأخذ `periodMonth` كما أرسله المتصفّح
 * ويفحص شكله وحده. فستّ فواتير مؤرَّخة في أغسطس حُفظت في سبتمبر — وهو
 * شهر رفعها. وأغسطس ناقصٌ بقيمتها، وإقفالُه يمرّ وهو لا يراها.
 *
 * والمصدر أُصلح؛ وهذا يُصلح ما مضى.
 *
 * **ولا يمسّ شهراً مقفلاً.** الإقفال إعلانٌ بأنّ الشهر تمّ، وتعديل
 * أرقامه بعده يحتاج فتحاً مسجَّلاً — لا سكربتاً.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { documents, invoices } from "@/db/schema";
import { monthOf } from "@/lib/filing";
import { recordAudit } from "@/lib/audit";
import { users } from "@/db/schema";

async function main() {
  const apply = process.argv.includes("--apply");

  const rows = await db
    .select({
      documentId: documents.id,
      invoiceId: invoices.id,
      fileName: documents.fileName,
      docMonth: documents.periodMonth,
      invMonth: invoices.periodMonth,
      invoiceDate: invoices.invoiceDate,
      totalMinor: invoices.totalMinor,
    })
    .from(invoices)
    .innerJoin(documents, eq(documents.id, invoices.documentId));

  const wrong = rows
    .map((r) => ({ ...r, should: monthOf(r.invoiceDate) }))
    .filter((r) => r.invMonth !== r.should);

  /* الشهر المقفل لا يُمَسّ — لا الذي جاءت منه ولا الذي تذهب إليه */
  const closed = new Set(
    (
      await db.execute<{ month: string }>(sql`
        select month from month_closes where status = 'CLOSED'
      `)
    ).rows.map((r) => r.month),
  );

  const movable = wrong.filter((r) => !closed.has(r.invMonth) && !closed.has(r.should));
  const blocked = wrong.filter((r) => closed.has(r.invMonth) || closed.has(r.should));

  console.log(`\n═══════════ الشهر المحاسبيّ ═══════════\n`);
  console.log(`  فواتير شهرُها يخالف تاريخها: ${wrong.length}\n`);

  for (const r of wrong) {
    const mark = closed.has(r.invMonth) || closed.has(r.should) ? "🔒" : apply ? "→" : "·";
    console.log(`  ${mark} ${r.fileName.slice(0, 62)}`);
    console.log(`     ${r.invMonth} ← ${r.should}  (تاريخها ${r.invoiceDate.toISOString().slice(0, 10)} · ${(r.totalMinor / 100).toFixed(2)} ريال)`);
  }

  if (blocked.length > 0) {
    console.log(`\n  🔒 ${blocked.length} منها في شهرٍ مقفل — لا تُمَسّ.`);
    console.log(`     افتح الشهر من /close إن أردتَ تصحيحها.`);
  }

  if (movable.length === 0) {
    console.log("\n  لا شيء يُصلَح.\n");
    process.exit(0);
  }

  if (!apply) {
    console.log(`\n  معاينة. للتنفيذ:  npm run db:repair-months -- --apply\n`);
    process.exit(0);
  }

  const [actor] = await db.select({ id: users.id }).from(users).limit(1);

  await db.transaction(async (tx) => {
    for (const r of movable) {
      await tx.update(invoices).set({ periodMonth: r.should }).where(eq(invoices.id, r.invoiceId));
      await tx.update(documents).set({ periodMonth: r.should }).where(eq(documents.id, r.documentId));
    }
  });

  await recordAudit({
    actorId: actor?.id ?? "",
    action: "DOCUMENT_ARCHIVED",
    entityType: "invoice",
    entityId: `repair-months:${movable.length}`,
    after: {
      الفعل: "صُحّح الشهر المحاسبيّ ليتبع تاريخ الفاتورة لا تاريخ الرفع",
      الفواتير: movable.map((r) => `${r.fileName}: ${r.invMonth} ← ${r.should}`),
      "لم تُمَسّ (شهر مقفل)": blocked.length,
    },
  });

  console.log(`\n  ✓ صُحّحت ${movable.length} فاتورة، وكُتب ذلك في سجلّ التدقيق.\n`);
  process.exit(0);
}

main().catch((e) => { console.error("\n✕", e.message, "\n"); process.exit(1); });
