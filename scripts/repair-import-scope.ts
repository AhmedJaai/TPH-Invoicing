/**
 * يوحّد نطاق الحساب، ويدمج ما انقسم بينه وبين «المجهول».
 *
 *   npm run db:repair-scope          يعرض ولا يكتب
 *   npm run db:repair-scope -- apply  ينفّذ
 *
 * ═══ ما وقع ═══
 *
 * فرادةُ الحركة مقيَّدة بحسابها (`014`) — وهو صحيح: حوالتان متطابقتان
 * من حسابين حركتان. لكنّ الحساب **معرفةٌ تتحسّن**: الكشوف الأولى
 * استُوردت ولا يُقرأ منها رقمُ الحساب فحُفظت بحسابٍ فارغ، ثمّ صار
 * القارئ يقرأ الرقم. فلمّا رُفع الكشف نفسه بحث عن سابقٍ في نطاق
 * الحساب الجديد ولم يجد — لأنّ القديم كلّه في نطاق «المجهول».
 *
 * فدخل ألفٌ وأربعمئة وستّ وثلاثون حركة ثانيةً، وصار الصادر ضعفه.
 *
 * **والدرس — وهو نفسه للمرّة الثالثة: هويّةٌ قُيِّدت بمعرفةٍ تتحسّن مع
 * الوقت ليست هويّة.** والفارغ ليس «حساباً آخر»، هو «لم نكن نعرف».
 *
 * ═══ وما يفعله هذا ═══
 *
 * لا يحذف ثمّ يخسر: يدمج أوّلاً. فالنسخة الجديدة قد تحمل عملَ إنسانٍ
 * وقع عليها بعد رفعها — تصنيفاً أكّده، أو دفعةً رُبطت بها — وحذفُها بلا
 * دمج يمحو ذلك العمل ويترك الدفعة بلا أثرٍ بنكيّ.
 */
import { eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../src/db";
import { bankTransactions } from "../src/db/schema";
import { recordAudit } from "../src/lib/audit";

const APPLY = process.argv.includes("apply");

interface Row extends Record<string, unknown> {
  id: string; k: string; acct: string | null; a: number;
  pay: string | null; src: string | null; cat: string; party: string | null;
  sup: string | null; reason: string | null; ver: string | null;
  disp: string | null; outcome: string | null; score: number | null;
  status: string; life: string; ty: string | null; ref: string | null; opref: string | null;
}

async function main() {
  const rows = (await db.execute<Row>(sql`
    select id,
      (value_date::date::text || '|' || amount_minor || '|' || direction::text || '|' ||
       upper(btrim(regexp_replace(coalesce(description,''), '\s+', ' ', 'g')))) as k,
      bank_account_id as acct, amount_minor as a, matched_payment_id as pay,
      classification_source::text as src, category::text as cat, counterparty_id as party,
      supplier_id as sup, classification_reason as reason, classification_version as ver,
      match_disposition::text as disp, match_outcome as outcome, match_score as score,
      match_status::text as status, lifecycle::text as life,
      transaction_type as ty, ref, operation_ref as opref
    from bank_transactions
  `)).rows;

  const byKey = new Map<string, Row[]>();
  for (const r of rows) {
    const g = byKey.get(r.k) ?? [];
    g.push(r);
    byKey.set(r.k, g);
  }

  /*
    المجموعة المنقسمة: فيها صفٌّ بحساب وصفٌّ بلا حساب، ومفتاحهما
    الطبيعيّ واحد. فهما حركةٌ واحدة فرّقها نطاقان لا واقعان.
  */
  const merges: { keep: Row; drop: Row }[] = [];
  for (const g of byKey.values()) {
    const known = g.filter((r) => r.acct !== null);
    const unknown = g.filter((r) => r.acct === null);
    if (known.length === 0 || unknown.length === 0) continue;

    /*
      تُقابَل واحدةً بواحدة، ولا يُبقى واحدٌ ويُحذف الباقي.

      لأنّ المجموعة قد تحمل تكراراً **حقيقيّاً**: كشفٌ واحد يذكر رسم
      القناة الرقمية مرّتين في اليوم، وهما رسمان وقعا. فلو أُبقي منها
      واحدٌ لأُكل الحقيقيّ مع المستعاد — تسعةَ عشر صفّاً في قاعدة أحمد.

      والباقي هو المجهول: الأقدم، وعليه بُني عملُ صاحب العمل كلّه —
      تأكيداته ودفعاته وأثر قراراته. ويُكتَب له الحساب بعد الدمج.

      وما زاد من المعروف عن عدد المجهول حركةٌ جديدة فعلاً، فتبقى.
    */
    const pairs = Math.min(known.length, unknown.length);
    for (let i = 0; i < pairs; i++) merges.push({ keep: unknown[i], drop: known[i] });
  }

  const dropped = merges.map((m) => m.drop);
  const withPay = dropped.filter((r) => r.pay !== null);
  const withHuman = dropped.filter((r) => r.src === "HUMAN");
  const sum = dropped.reduce((n, r) => n + Number(r.a), 0);

  console.log(`الحركات الآن            ${rows.length}`);
  console.log(`مجموعات منقسمة          ${merges.length}`);
  console.log(`ستُدمَج وتُحذَف          ${dropped.length}  (${(sum / 100).toFixed(2)} ريال)`);
  console.log(`  منها مرتبطة بدفعة     ${withPay.length}  ← تُنقَل الدفعة إلى الباقي`);
  console.log(`  منها صنّفها إنسان     ${withHuman.length}  ← يُنقَل تصنيفه`);
  console.log(`ستبقى                   ${rows.length - dropped.length}`);

  const stillNull = rows.length - dropped.length;
  console.log(`\nثمّ يُكتَب الحساب لـ${stillNull} حركة — فينتهي نطاق «المجهول»`);

  if (!APPLY) {
    console.log("\nعرضٌ فقط. للتنفيذ:  npm run db:repair-scope -- apply");
    process.exit(0);
  }

  const account = (await db.execute<{ id: string }>(sql`
    select id from bank_accounts order by created_at limit 1
  `)).rows[0];
  if (!account) { console.log("✕ لا حساب مسجَّل — تُوقَف."); process.exit(1); }

  let moved = 0;
  for (const m of merges) {
    /* ما لا يملكه الباقي يأخذه من نسخته قبل أن تُحذف */
    const donor = m.drop;
    const patch: Record<string, unknown> = {};

    if (m.keep.pay === null && donor.pay !== null) {
      patch.matchedPaymentId = donor.pay;
      patch.matchStatus = donor.status;
      patch.matchDisposition = donor.disp;
      patch.matchOutcome = donor.outcome;
      patch.matchScore = donor.score;
      patch.lifecycle = donor.life;
      moved++;
    }
    const human = donor.src === "HUMAN" ? donor : null;
    if (human && m.keep.src !== "HUMAN") {
      patch.category = human.cat;
      patch.counterpartyId = human.party;
      patch.supplierId = human.sup;
      patch.classificationSource = "HUMAN";
      patch.classificationReason = human.reason;
      patch.classificationVersion = human.ver;
      patch.lifecycle = human.life;
    }
    if (!m.keep.ty && donor.ty) patch.transactionType = donor.ty;
    if (!m.keep.ref && donor.ref) patch.ref = donor.ref;
    if (!m.keep.opref && donor.opref) patch.operationRef = donor.opref;

    if (Object.keys(patch).length > 0) {
      await db.update(bankTransactions).set(patch).where(eq(bankTransactions.id, m.keep.id));
    }
  }

  const ids = dropped.map((d) => d.id);
  for (let i = 0; i < ids.length; i += 400) {
    await db.delete(bankTransactions).where(inArray(bankTransactions.id, ids.slice(i, i + 400)));
  }

  /* ثمّ لا يبقى مجهول: كلّ ما بقي من هذا الحساب */
  const adopted = await db
    .update(bankTransactions)
    .set({ bankAccountId: account.id })
    .where(isNull(bankTransactions.bankAccountId));

  await recordAudit({
    actorId: null,
    action: "BANK_IMPORTED",
    entityType: "bank_account",
    entityId: account.id,
    after: {
      السبب: "نطاق الحساب انقسم: القديم بحسابٍ فارغ والجديد بحساب — فدخل الكشف مرّتين",
      "حركات دُمجت وحُذفت": dropped.length,
      "دفعات نُقلت": moved,
      المبلغ: sum,
    },
  });

  const left = (await db.execute<{ n: number; nulls: number }>(sql`
    select count(*)::int as n, count(*) filter (where bank_account_id is null)::int as nulls
    from bank_transactions
  `)).rows[0];
  console.log(`\n✓ حُذف ${dropped.length} · نُقلت ${moved} دفعة · تُبنّي ${adopted.rowCount} · بقي ${left.n} (بلا حساب: ${left.nulls})`);
  process.exit(0);
}

main();
