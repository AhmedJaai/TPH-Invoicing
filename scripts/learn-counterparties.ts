/**
 * يُنشئ ذاكرة المستفيدين من الأدلّة القاطعة وحدها.
 *
 * أحمد طلب حلّ المعلّقات وتعليم الذاكرة. ولا تُصنَّف حركةٌ هنا بالتخمين:
 * تُجمَع الحركات بهويّةٍ **قاطعة** — رقم هوية أو حساب أو آيبان — ثمّ
 * يُعرَض على أحمد ما يقوله وصفُها الصريح عن بابها. وما لم يكن دليله
 * قاطعاً يُترَك لشاشة المعلّقات.
 *
 *   npm run db:learn           يعرض ولا يكتب
 *   npm run db:learn -- apply   ينفّذ
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { toCanonical } from "../src/lib/bank/canonical";
import { merchantKey } from "../src/lib/bank/classification";
import { evidenceFrom } from "../src/services/counterparty.service";
import { createId } from "../src/lib/id";
import type { TxCategory } from "../src/lib/bank/rules";

const APPLY = process.argv.includes("apply");

/**
 * ما يقوله الوصف الصريح عن باب الحركة.
 *
 * ولا يُخمَّن: العبارة موجودة أو لا. و«شراء بضاعة» تُقدَّم على «رواتب»
 * في الوصف نفسه — وقد وُجد ذلك في كشف أحمد.
 */
function explicitKind(text: string): { kind: TxCategory; why: string } | null {
  if (/شراء\s*بضاعه|شراء\s*بضاعة/i.test(text)) {
    return { kind: "SUPPLIER", why: "الوصف يقول «شراء بضاعة» صراحةً" };
  }
  if (/تحويل\s*الي\s*الاهل|الاهل\s*والاصدقاء/i.test(text)) {
    return { kind: "PERSONAL", why: "الوصف يقول «تحويل إلى الأهل والأصدقاء»" };
  }
  if (/BV:\s*رواتب|رواتب\s*شهريه|Monthly\s*Sal/i.test(text)) {
    return { kind: "SALARY", why: "الوصف يقول «رواتب شهرية»" };
  }
  if (/\bEJAR\b/i.test(text)) return { kind: "RENT", why: "منصّة إيجار" };
  if (/Saudi\s*Energy|كهرباء|SAUDI\s*TELECOM|\bSTC\b/i.test(text)) {
    return { kind: "UTILITY", why: "مزوّد كهرباء أو اتصالات" };
  }
  if (/\bZATCA\b|التامينات\s*الاجتماعيه|\bGOSI\b/i.test(text)) {
    return { kind: "GOVERNMENT", why: "جهة حكومية" };
  }
  return null;
}

/**
 * الاسم من الوصف لا من عمود المستفيد.
 *
 * عمود `beneficiary_raw` في الحركات القديمة كان يحمل **اسم المورّد
 * الذي رجّحه المُطابِق** لا المستفيد الحقيقيّ — وهو خللٌ أُصلح، لكنّ
 * الصفوف القديمة بقيت ملوّثة. فظهرت «لوريفا كيك» اسماً لهويّتين
 * مختلفتين، إحداهما راتبُ شخصٍ آخر.
 *
 * والوصف نفسه يحمل الاسم قبل «BEN ID» — وهو ما كتبه البنك لا ما
 * خمّنّاه.
 */
function nameFromDescription(description: string | null): string | null {
  if (!description) return null;
  const before = description.split(/BEN\s*ID/i)[0]?.trim();
  if (!before || before.length < 4) return null;
  // يُقصّ عند أوّل رقم طويل: ما بعده مراجع لا اسم
  const clean = before.split(/\s\d{6,}/)[0].trim();
  return clean.length >= 4 ? clean.slice(0, 60) : null;
}

interface Group {
  key: string;
  displayName: string;
  kind: TxCategory;
  why: string;
  count: number;
  amountMinor: number;
  txIds: string[];
  evidence: ReturnType<typeof evidenceFrom>;
}

async function main() {
  const rows = (
    await db.execute<Record<string, string | number | null>>(sql`
      select id, description, beneficiary_raw, transaction_type, amount_minor,
             direction::text as direction, value_date
      from bank_transactions
      where counterparty_id is null and direction = 'DEBIT'
    `)
  ).rows;

  const groups = new Map<string, Group>();
  let noIdentity = 0;
  let noExplicitKind = 0;

  for (const r of rows) {
    const tx = toCanonical({
      valueDate: new Date(r.value_date as string),
      description: r.description as string | null,
      beneficiaryRaw: r.beneficiary_raw as string | null,
      transactionType: r.transaction_type as string | null,
      amountMinor: Number(r.amount_minor),
      direction: "DEBIT",
    });

    /*
      الهويّة القاطعة وحدها: رقم هوية أو حساب أو آيبان. أمّا الاسم
      فقد يتشابه، ولا يُبنى عليه تعلّمٌ يعمّ.
    */
    const key = merchantKey(tx);
    if (!key || key.startsWith("NAME:")) { noIdentity++; continue; }

    const explicit = explicitKind(tx.searchText);
    if (!explicit) { noExplicitKind++; continue; }

    const evidence = evidenceFrom(tx).filter((e) => e.kind !== "NAME");
    if (evidence.length === 0) { noIdentity++; continue; }

    const g = groups.get(key) ?? {
      key,
      displayName: nameFromDescription(r.description as string | null)
        ?? (tx.beneficiaryRaw ?? tx.searchText.slice(0, 40)).trim(),
      kind: explicit.kind,
      why: explicit.why,
      count: 0,
      amountMinor: 0,
      txIds: [],
      evidence,
    };

    // تضارب الباب داخل الهويّة الواحدة: تُترَك للإنسان
    if (g.kind !== explicit.kind) {
      groups.delete(key);
      noExplicitKind++;
      continue;
    }

    g.count++;
    g.amountMinor += Number(r.amount_minor);
    g.txIds.push(r.id as string);
    groups.set(key, g);
  }

  const list = [...groups.values()].sort((a, b) => b.amountMinor - a.amountMinor);

  console.log(`حركات بلا جهة: ${rows.length}`);
  console.log(`  بلا هويّة قاطعة        : ${noIdentity}`);
  console.log(`  بلا وصفٍ صريح لبابها   : ${noExplicitKind}`);
  console.log(`  جهاتٌ يمكن تعلّمها     : ${list.length}\n`);

  for (const g of list) {
    console.log(
      `${String(g.count).padStart(4)} حركة · ${(g.amountMinor / 100).toFixed(2).padStart(12)} · ` +
      `${g.kind.padEnd(11)} · ${g.displayName.slice(0, 34)}`,
    );
    console.log(`      ${g.why} · ${g.evidence.map((e) => `${e.kind}=${e.value}`).join(" ")}`);
  }

  const total = list.reduce((s, g) => s + g.count, 0);
  console.log(`\nستُصنَّف ${total} حركة بـ${list.length} جهة.`);

  if (!APPLY) {
    console.log("عرضٌ فقط. للتنفيذ:  npm run db:learn -- apply");
    process.exit(0);
  }

  let created = 0;
  let linked = 0;

  for (const g of list) {
    const partyId = createId();
    await db.transaction(async (t) => {
      await t.execute(sql`
        insert into counterparties (id, display_name, kind, created_at, updated_at)
        values (${partyId}, ${g.displayName}, ${g.kind}::tx_category, now(), now())
      `);
      created++;

      for (const e of g.evidence) {
        await t.execute(sql`
          insert into counterparty_evidence (id, counterparty_id, kind, value, normalized)
          values (${createId()}, ${partyId}, ${e.kind}::counterparty_evidence_kind,
                  ${e.value}, ${e.normalized})
          on conflict (kind, normalized) do nothing
        `);
      }

      for (const txId of g.txIds) {
        await t.execute(sql`
          update bank_transactions
          set counterparty_id = ${partyId}, category = ${g.kind}::tx_category
          where id = ${txId}
        `);
        linked++;
      }
    });
  }

  console.log(`\n✓ أُنشئت ${created} جهة، ونُسبت إليها ${linked} حركة.`);
  process.exit(0);
}

main();
