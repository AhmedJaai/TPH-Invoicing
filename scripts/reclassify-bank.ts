/**
 * يعيد تصنيف الحركات المخزَّنة بالمحرّك الجديد — **بذاكرته**.
 *
 *   npm run db:reclassify           يعرض ولا يكتب
 *   npm run db:reclassify -- apply   ينفّذ
 *
 * ولا يمسّ حركةً ربطها إنسانٌ بدفعة، ولا حركةً صنّفها إنسانٌ بنفسه:
 * تصنيفه أوثق من استنتاج الآلة.
 *
 * وكان يستدعي `classify` بلا ذاكرة — أي أنّه يُلغي، في كل مرّة
 * يُشغَّل، كلَّ ما تعلّمه النظام من تأكيدات صاحب العمل. فالمسار الذي
 * يُفترَض أن ينشر التعلّم كان يمحوه.
 *
 * وكان يكتب `category` وحده ويترك `classification_source` كما هو: حقلٌ
 * موجودٌ يقول شيئاً غير ما وقع. ونصفُ كتابةٍ أسوأ من لا كتابة.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import { bankTransactions, decisionHistory } from "../src/db/schema";
import { beneficiaryFrom, normalizeText, toCanonical } from "../src/lib/bank/canonical";
import { classify, CLASSIFICATION_VERSION } from "../src/lib/bank/classification";
import { toCategory } from "../src/lib/bank/apply";
import { CATEGORY_LABEL } from "../src/lib/bank/rules";
import { loadMerchantMemory } from "../src/services/counterparty.service";

const APPLY = process.argv.includes("apply");

async function main() {
  const rows = (await db.execute<{
    id: string; description: string | null; beneficiary_raw: string | null;
    transaction_type: string | null; amount_minor: number; direction: string;
    value_date: string; category: string; matched_payment_id: string | null;
    classification_source: string | null;
  }>(sql`
    select id, description, beneficiary_raw, transaction_type, amount_minor,
           direction::text as direction, value_date, category::text as category,
           matched_payment_id, classification_source::text as classification_source
    from bank_transactions
  `)).rows;

  const memory = await loadMerchantMemory();
  console.log(`ذاكرة المستفيدين: ${memory.size} مفتاحاً\n`);

  const changes = new Map<string, { from: string; to: string; n: number }>();
  const updates: {
    id: string; category: string; source: string; reason: string;
  }[] = [];
  let skipped = 0;

  for (const r of rows) {
    if (r.matched_payment_id || r.classification_source === "HUMAN") { skipped++; continue; }

    const c = classify(toCanonical({
      valueDate: new Date(r.value_date),
      description: r.description,
      beneficiaryRaw: r.beneficiary_raw,
      transactionType: r.transaction_type,
      amountMinor: Number(r.amount_minor),
      direction: r.direction as "DEBIT" | "CREDIT",
    }), memory);
    const next = toCategory(c.kind);

    // يُعاد الكتابةُ أيضاً حين لا يتغيّر الباب لكن يتغيّر مصدره: «كيف
    // عُرف» جزءٌ من الجواب لا زينةٌ حوله
    if (next === r.category && c.source === r.classification_source) continue;

    const key = `${r.category}→${next}`;
    const e = changes.get(key) ?? { from: r.category, to: next, n: 0 };
    e.n++;
    changes.set(key, e);
    updates.push({ id: r.id, category: next, source: c.source, reason: c.reason });
  }

  console.log(`الحركات ${rows.length} · ستتغيّر ${updates.length} · أقرّها إنسانٌ فتُترَك ${skipped}\n`);
  for (const c of [...changes.values()].sort((a, b) => b.n - a.n)) {
    const L = (k: string) => CATEGORY_LABEL[k as keyof typeof CATEGORY_LABEL] ?? k;
    console.log(String(c.n).padStart(5), `${L(c.from)} → ${L(c.to)}`);
  }

  if (!APPLY) {
    console.log("\nعرضٌ فقط. للتنفيذ:  npm run db:reclassify -- apply");
    process.exit(0);
  }

  /*
    تُكتَب صفّاً صفّاً لا بمصفوفةٍ مبنيّة بالنصّ: السبب والمصدر نصّان
    يأتيان من المصنِّف، وبناء SQL بلصقهما بابٌ لا يُفتَح على بيانات
    مالية. والألفان قليل على نصٍّ يُشغَّل باليد.
  */
  let done = 0;
  for (const u of updates) {
    await db
      .update(bankTransactions)
      .set({
        category: u.category as typeof bankTransactions.$inferInsert.category,
        classificationSource:
          u.source as typeof bankTransactions.$inferInsert.classificationSource,
        classificationReason: u.reason,
        classificationVersion: CLASSIFICATION_VERSION,
      })
      .where(eq(bankTransactions.id, u.id));

    await db.insert(decisionHistory).values({
      bankTransactionId: u.id,
      event: "CLASSIFIED",
      actor: u.source === "MEMORY" ? "MEMORY" : "SYSTEM",
      detail: u.reason,
      payload: { الباب: u.category, المصدر: u.source, النسخة: CLASSIFICATION_VERSION },
    });

    done++;
    if (done % 200 === 0) process.stdout.write(`\r  … ${done}/${updates.length}`);
  }

  console.log(`\n✓ حُدّثت ${updates.length} حركة — بابها ومصدرها وسببها وأثرها`);

  /*
    ── وتُطوى القرارات التي لم يعد لها موضوع ──

    `match_disposition` عمودٌ عن مطابقة **فاتورة**. فحركةٌ بابُها رسمٌ
    بنكيّ أو تسويةُ شبكة لا فاتورة لها تُطابَق، وبقاءُ «تنتظر مراجعتك»
    عليها يُبقيها في الطابور إلى الأبد — يُسأل صاحبُ العمل عن رسمٍ
    بقرشين صُنّف تلقائياً منذ شهر.
  */
  const cleared = await db.execute(sql`
    update bank_transactions
    set match_disposition = null, match_outcome = null, match_score = null
    where matched_payment_id is null
      and match_disposition is not null
      and category not in ('SUPPLIER', 'UNKNOWN')
  `);
  console.log(`✓ طُويت ${cleared.rowCount} قراراً لا موضوع له — أبوابها ليست سداد مورّد`);

  /*
    ── والمستفيد يُعاد إلى ما قاله البنك ──

    العمود ملوَّث: كان الاستيراد القديم يكتب فيه اسم المورّد الذي طابقه
    هو. سبعةٌ وثلاثون صفّاً من ستّة وأربعين. وأثرُه أنّه يُعرَض لصاحب
    العمل اسمَ جهةٍ لم يذكرها البنك، ويُجمَع به ما لا يجتمع.

    فيُقرأ من الوصف. وما لا يُقرأ منه يُفرَّغ: الفراغ يقول «لم يذكره
    البنك»، والاسم المُقحَم يقول ما ليس صحيحاً.
  */
  const benRows = (await db.execute<{ id: string; b: string | null; d: string | null }>(sql`
    select id, beneficiary_raw as b, description as d from bank_transactions
  `)).rows;

  let fixed = 0, emptied = 0;
  for (const r of benRows) {
    const derived = beneficiaryFrom(r.d);
    const stored = r.b?.trim() ?? null;
    const corroborated = stored && normalizeText(r.d).toUpperCase()
      .includes(normalizeText(stored).toUpperCase());
    const next = derived ?? (corroborated ? stored : null);
    if (next === stored) continue;

    await db.update(bankTransactions)
      .set({ beneficiaryRaw: next })
      .where(eq(bankTransactions.id, r.id));
    if (next === null) emptied++; else fixed++;
  }
  console.log(`✓ المستفيد: صُحّح ${fixed} · فُرّغ ${emptied} لم يذكره البنك`);
  process.exit(0);
}
main();
