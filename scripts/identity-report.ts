/**
 * هويّة الحركات المقيَّدة: تُحسَب، وتُعرَض، ثمّ تُكتَب.
 *
 *   npm run db:identity          يعرض ولا يكتب
 *   npm run db:identity -- apply  يكتب الهويّة والمرجع — **ولا يحذف شيئاً**
 *
 * ولا يحذف عمداً. تنظيفُ المكرَّر قرارٌ ماليّ: يُعرَض بدليله ويُنتظَر
 * فيه إنسان. وهذا يقول ما عنده فقط:
 *
 *   مكرَّرٌ قاطع    — مرجعُ عمليّةٍ واحد لصفّين. لا شكّ فيه.
 *   مكرَّرٌ محتمل   — وقائعُ واحدة، وأحدهما بمرجعٍ والآخر بلا. يُعرَض.
 *   تكرارٌ مشروع   — متطابقان بلا مرجع: رسمان في يوم، وهما حقيقيّان.
 *   فريدٌ مؤكَّد    — ما عداه.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import { bankTransactions } from "../src/db/schema";
import { toCanonical } from "../src/lib/bank/canonical";
import { operationRef, operationRefs } from "../src/lib/bank/identity";
import { factKey, identityKeyOf, looseKey } from "../src/lib/bank/sync";

const APPLY = process.argv.includes("apply");

async function main() {
  const rows = (await db.execute<{
    id: string; v: string; a: number; dir: string; descr: string | null;
    ty: string | null; ben: string | null; acct: string | null; pay: string | null;
  }>(sql`
    select id, value_date::text as v, amount_minor as a, direction::text as dir,
           description as descr, transaction_type as ty, beneficiary_raw as ben,
           bank_account_id as acct, matched_payment_id as pay
    from bank_transactions order by value_date, id
  `)).rows;

  interface Item {
    id: string; acct: string | null; refs: string[]; ref: string | null;
    facts: string; lax: string; key: string; occurrence: number; paid: boolean;
  }

  const seen = new Map<string, number>();
  const items: Item[] = rows.map((r) => {
    const tx = toCanonical({
      valueDate: new Date(r.v), description: r.descr, beneficiaryRaw: r.ben,
      transactionType: r.ty, amountMinor: Number(r.a), direction: r.dir as "DEBIT" | "CREDIT",
    });
    const facts = factKey(tx);
    const n = seen.get(facts) ?? 0;
    seen.set(facts, n + 1);
    const ref = operationRef(tx);
    return {
      id: r.id, acct: r.acct, refs: operationRefs(tx), ref,
      facts, lax: looseKey(tx),
      key: identityKeyOf(r.acct, ref, facts, n),
      occurrence: n, paid: r.pay !== null,
    };
  });

  /* ── مكرَّرٌ قاطع: مرجعٌ واحد لصفّين ── */
  const byRef = new Map<string, Item[]>();
  for (const i of items) {
    if (!i.ref) continue;
    const g = byRef.get(i.ref) ?? [];
    g.push(i);
    byRef.set(i.ref, g);
  }
  const hardGroups = [...byRef.values()].filter((g) => g.length > 1);

  /* ── تكرارٌ مشروع: متطابقان بلا مرجع ── */
  const byFacts = new Map<string, Item[]>();
  for (const i of items) {
    const g = byFacts.get(i.facts) ?? [];
    g.push(i);
    byFacts.set(i.facts, g);
  }
  const legit = [...byFacts.values()].filter((g) => g.length > 1 && g.every((x) => !x.ref));

  /* ── مكرَّرٌ محتمل: وقائع متساهلة، وأحدهما بمرجع والآخر بلا ── */
  const byLax = new Map<string, Item[]>();
  for (const i of items) {
    const g = byLax.get(i.lax) ?? [];
    g.push(i);
    byLax.set(i.lax, g);
  }
  const soft = [...byLax.values()].filter((g) =>
    g.length > 1
    && g.some((x) => x.ref !== null)
    && g.some((x) => x.ref === null)
    && !hardGroups.some((h) => h.some((x) => g.includes(x))));

  const hardExtra = hardGroups.reduce((n, g) => n + g.length - 1, 0);
  const softRows = soft.reduce((n, g) => n + g.length, 0);
  const legitRows = legit.reduce((n, g) => n + g.length, 0);

  console.log(`حركات بنكية        ${items.length}`);
  console.log(`مكرَّرٌ قاطع         ${hardExtra} صفّاً زائداً في ${hardGroups.length} مجموعة`);
  console.log(`مكرَّرٌ محتمل        ${softRows} صفّاً في ${soft.length} مجموعة — يُعرَض ولا يُحسَم`);
  console.log(`تكرارٌ مشروع        ${legitRows} صفّاً في ${legit.length} مجموعة — متطابقة بلا مرجع`);
  console.log(`فريدٌ مؤكَّد         ${items.length - hardExtra - softRows}`);

  if (hardGroups.length > 0) {
    console.log(`\n── المكرَّر القاطع ──`);
    for (const g of hardGroups.slice(0, 12)) {
      console.log(`  ${g[0].ref}`);
      for (const x of g) console.log(`     ${x.id}${x.paid ? "  ← مرتبطة بدفعة" : ""}`);
    }
  }
  if (soft.length > 0) {
    console.log(`\n── المحتمل (لا يُحذَف) ──`);
    for (const g of soft.slice(0, 12)) {
      console.log(`  ${g[0].lax.slice(0, 76)}`);
      for (const x of g) console.log(`     ${x.id} · مرجع ${x.ref ?? "—"}${x.paid ? " · بدفعة" : ""}`);
    }
  }

  if (!APPLY) {
    console.log("\nعرضٌ فقط. للكتابة (بلا حذف):  npm run db:identity -- apply");
    process.exit(0);
  }

  /*
    تُكتَب الهويّة لما لا التباس فيه. والمكرَّر القاطع يُترَك بلا هويّة
    حتى يُحسَم: كتابةُ مفتاحٍ واحد لصفّين يردّها القيد، وكتابتُه لأحدهما
    ادّعاءٌ بأنّ الآخر عمليّةٌ ثانية.
  */
  const held = new Set(hardGroups.flatMap((g) => g.map((x) => x.id)));
  let written = 0;
  for (const i of items) {
    if (held.has(i.id)) continue;
    await db.update(bankTransactions)
      .set({ identityKey: i.key, operationRef: i.ref, occurrence: i.occurrence })
      .where(eq(bankTransactions.id, i.id));
    written++;
  }
  console.log(`\n✓ كُتبت الهويّة لـ${written} حركة · تُركت ${held.size} موقوفة بلا هويّة`);
  process.exit(0);
}

main();
