/**
 * يزيل تكرار حركات البنك الناتج عن **استيراد الكشف نفسه مرّتين**.
 *
 *   npm run db:dedupe          يعرض ولا يحذف
 *   npm run db:dedupe -- apply  ينفّذ
 *
 * ═══ لماذا وقع التكرار ═══
 *
 * لأنّ هوية الحركة كانت **بصمةً تُحسَب بدالّة**، والدالّة تغيّرت: خرج
 * منها رقم الحساب. فحركةٌ واحدة بعينها — نفس التاريخ ونفس المبلغ ونفس
 * الوصف حرفاً بحرف — لها بصمتان: واحدة كُتبت قبل التغيير وأخرى بعده.
 * فلم يرَ الاستيراد الثاني الأوّل، ودخل الكشف كلّه مرّة ثانية.
 *
 * والدرس أعمق من الحادثة: **تغييرُ دالّة الهوية يُبطل بأثرٍ رجعيّ كلَّ
 * ما حُفظ بها.** ولذلك صار المنع في `020` قيداً على **المفتاح الطبيعيّ
 * نفسه** — التاريخ والمبلغ والاتجاه والوصف والترتيب — لا على بصمةٍ
 * تُشتقّ منه. المفتاح الطبيعيّ لا «نسخة» له تتغيّر.
 *
 * ═══ ولماذا لا يُحذف كلّ ما تشابه ═══
 *
 * لأنّ الكشف الواحد قد يحمل حركتين متطابقتين في اليوم — رسمَين، أو
 * حوالتين لمورّدٍ واحد بفاتورتين. وهما حقيقيّتان.
 *
 * فالعدد الصحيح لحركةٍ ما ليس واحداً، وليس مجموعَ ما في الملفّين، بل
 * **أكثر ما قاله ملفٌّ واحد**: كل كشفٍ يذكر الحركة بعدد ما وقعت. فإن
 * قال كشفان «مرّتين» فهي مرّتان لا أربع. وإن قال أحدهما «مرّتين»
 * والآخر «مرّة» فهي مرّتان — لأنّ الناقص نقصُ تغطيةٍ لا نفيُ وقوع.
 *
 * وبهذا يُحذف ما تكرّر بالاستيراد وحده، ويبقى ما تكرّر في الواقع.
 *
 * ═══ والحذف يُسبَق بدمج ═══
 *
 * النسختان ليستا متطابقتين: كلّ تصديرٍ يحمل ما لا يحمله الآخر. في
 * قاعدة أحمد كان الباقي — وهو الأقدم — بلا «نوع العملية» في ألفٍ
 * وأربعمئة حركة، والمحذوف يحمله. فحذفٌ بلا دمج يشتري إزالة التكرار
 * بثمنِ حقلٍ لا يُستعاد إلّا بإعادة استيراد الكشف.
 */
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../src/db";
import { bankTransactions } from "../src/db/schema";
import { toCanonical } from "../src/lib/bank/canonical";
import { operationRef } from "../src/lib/bank/identity";

const APPLY = process.argv.includes("apply");

async function main() {
  const before = (await db.execute<{ n: number }>(sql`
    select count(*)::int as n from bank_transactions
  `)).rows[0];

  /*
    `keep` = أكثر ما قاله ملفٌّ واحد. و`rn` ترتيبٌ داخل المفتاح يُقدَّم
    فيه المرتبط بدفعة — فلا يُحذف ما يُثبت سداداً — ثمّ الأقدم، فلا
    تنكسر إحالةٌ إلى حركة قديمة. وما جاوز `keep` هو الزائد بالاستيراد.
  */
  const plan = (await db.execute<{
    groups: number; extra: number; s: string; withpay: number;
  }>(sql`
    with counted as (
      select t.id, t.amount_minor, t.matched_payment_id, i.created_at,
             t.value_date, t.direction,
             upper(btrim(regexp_replace(coalesce(t.description,''), '\s+', ' ', 'g'))) as descr,
             coalesce(t.bank_account_id, '~') as acct,
             t.bank_import_id
      from bank_transactions t
      join bank_imports i on i.id = t.bank_import_id
    ),
    per_file as (
      select acct, value_date, amount_minor, direction, descr, bank_import_id, count(*)::int as n
      from counted group by 1,2,3,4,5,6
    ),
    seen as (
      select coalesce(bank_account_id, '~') as acct, value_date, amount_minor, direction,
             upper(btrim(regexp_replace(coalesce(description,''), '\s+', ' ', 'g'))) as descr,
             (max(occurrence) + 1)::int as accepted
      from bank_transactions group by 1,2,3,4,5
    ),
    truth as (
      select p.acct, p.value_date, p.amount_minor, p.direction, p.descr,
             greatest(max(p.n)::int, max(s2.accepted)) as keep
      from per_file p
      join seen s2 on s2.acct = p.acct and s2.value_date = p.value_date
                  and s2.amount_minor = p.amount_minor and s2.direction = p.direction
                  and s2.descr = p.descr
      group by 1,2,3,4,5
    ),
    ranked as (
      select c.*, tr.keep,
             row_number() over (
               partition by c.acct, c.value_date, c.amount_minor, c.direction, c.descr
               order by (c.matched_payment_id is null), c.created_at, c.id
             ) as rn
      from counted c
      join truth tr on tr.acct = c.acct and tr.value_date = c.value_date
                   and tr.amount_minor = c.amount_minor
                   and tr.direction = c.direction and tr.descr = c.descr
    )
    select count(distinct (acct, value_date, amount_minor, direction, descr))::int as groups,
           count(*)::int                                                    as extra,
           coalesce(sum(amount_minor),0)::bigint                            as s,
           count(*) filter (where matched_payment_id is not null)::int      as withpay
    from ranked where rn > keep
  `)).rows[0];

  console.log(`الحركات الآن           ${before.n}`);
  console.log(`الزائدة بالاستيراد     ${plan.extra}  (في ${plan.groups} مجموعة)`);
  console.log(`مبلغها المكرّر         ${(Number(plan.s) / 100).toFixed(2)} ريال`);
  console.log(`منها مرتبطة بدفعة      ${plan.withpay}  ${plan.withpay > 0 ? "⚠ تُفحص يدوياً" : "(لا شيء)"}`);
  console.log(`ستبقى                  ${before.n - plan.extra}`);

  const real = (await db.execute<{ n: number; rows: number }>(sql`
    with per_file as (
      select coalesce(t.bank_account_id, '~') as acct, t.value_date, t.amount_minor, t.direction,
             upper(btrim(regexp_replace(coalesce(t.description,''), '\s+', ' ', 'g'))) as descr,
             t.bank_import_id, count(*)::int as n
      from bank_transactions t group by 1,2,3,4,5,6
    ),
    truth as (
      select acct, value_date, amount_minor, direction, descr, max(n)::int as keep
      from per_file group by 1,2,3,4,5
    )
    select count(*)::int as n, sum(keep)::int as rows from truth where keep > 1
  `)).rows[0];
  console.log(`\nتكرارٌ حقيقيّ يبقى     ${real.n} مجموعة (${real.rows} حركة) — كشفٌ واحد ذكرها أكثر من مرّة`);

  if (!APPLY) {
    await byOperationRef();
    console.log("\nعرضٌ فقط. للتنفيذ:  npm run db:dedupe -- apply");
    process.exit(0);
  }

  if (plan.withpay > 0) {
    console.log("\n✕ توقّف: بعض ما سيُحذف مرتبط بدفعات. راجعها قبل الحذف.");
    process.exit(1);
  }

  /*
    ── الدمج قبل الحذف ──

    ينتقل إلى الباقي ما ليس عنده ممّا عند نسخته: «نوع العملية»
    والمرجع. ولا يُنقَل اسم المستفيد: في الصفوف القديمة كان يُكتب فيه
    اسمُ المورّد المطابَق لا المستفيد الحقيقيّ، فنقلُه ينشر تلوّثاً لا
    يعالجه.
  */
  const merged = await db.execute(sql`
    with counted as (
      select t.id, t.transaction_type, t.ref, t.matched_payment_id, i.created_at,
             t.value_date, t.amount_minor, t.direction,
             upper(btrim(regexp_replace(coalesce(t.description,''), '\s+', ' ', 'g'))) as descr,
             coalesce(t.bank_account_id, '~') as acct,
             t.bank_import_id
      from bank_transactions t join bank_imports i on i.id = t.bank_import_id
    ),
    per_file as (
      select acct, value_date, amount_minor, direction, descr, bank_import_id, count(*)::int as n
      from counted group by 1,2,3,4,5,6
    ),
    seen as (
      select coalesce(bank_account_id, '~') as acct, value_date, amount_minor, direction,
             upper(btrim(regexp_replace(coalesce(description,''), '\s+', ' ', 'g'))) as descr,
             (max(occurrence) + 1)::int as accepted
      from bank_transactions group by 1,2,3,4,5
    ),
    truth as (
      select p.acct, p.value_date, p.amount_minor, p.direction, p.descr,
             greatest(max(p.n)::int, max(s2.accepted)) as keep
      from per_file p
      join seen s2 on s2.acct = p.acct and s2.value_date = p.value_date
                  and s2.amount_minor = p.amount_minor and s2.direction = p.direction
                  and s2.descr = p.descr
      group by 1,2,3,4,5
    ),
    ranked as (
      select c.*, tr.keep,
             row_number() over (
               partition by c.acct, c.value_date, c.amount_minor, c.direction, c.descr
               order by (c.matched_payment_id is null), c.created_at, c.id
             ) as rn
      from counted c
      join truth tr on tr.acct = c.acct and tr.value_date = c.value_date
                   and tr.amount_minor = c.amount_minor
                   and tr.direction = c.direction and tr.descr = c.descr
    ),
    donor as (
      select acct, value_date, amount_minor, direction, descr,
             max(transaction_type) as transaction_type,
             max(ref)              as ref
      from ranked where rn > keep
      group by 1,2,3,4,5
    )
    update bank_transactions t
    set transaction_type = coalesce(t.transaction_type, d.transaction_type),
        ref              = coalesce(t.ref, d.ref)
    from ranked k
    join donor d on d.acct = k.acct and d.value_date = k.value_date
                and d.amount_minor = k.amount_minor
                and d.direction = k.direction and d.descr = k.descr
    where k.rn <= k.keep and t.id = k.id
      and ((t.transaction_type is null and d.transaction_type is not null)
        or (t.ref is null and d.ref is not null))
  `);
  console.log(`\nدُمج إلى الباقي: ${merged.rowCount} حركة استعادت نوعها أو مرجعها`);

  const res = await db.execute(sql`
    with counted as (
      select t.id, t.matched_payment_id, i.created_at, t.value_date, t.amount_minor, t.direction,
             upper(btrim(regexp_replace(coalesce(t.description,''), '\s+', ' ', 'g'))) as descr,
             coalesce(t.bank_account_id, '~') as acct,
             t.bank_import_id
      from bank_transactions t join bank_imports i on i.id = t.bank_import_id
    ),
    per_file as (
      select acct, value_date, amount_minor, direction, descr, bank_import_id, count(*)::int as n
      from counted group by 1,2,3,4,5,6
    ),
    seen as (
      select coalesce(bank_account_id, '~') as acct, value_date, amount_minor, direction,
             upper(btrim(regexp_replace(coalesce(description,''), '\s+', ' ', 'g'))) as descr,
             (max(occurrence) + 1)::int as accepted
      from bank_transactions group by 1,2,3,4,5
    ),
    truth as (
      select p.acct, p.value_date, p.amount_minor, p.direction, p.descr,
             greatest(max(p.n)::int, max(s2.accepted)) as keep
      from per_file p
      join seen s2 on s2.acct = p.acct and s2.value_date = p.value_date
                  and s2.amount_minor = p.amount_minor and s2.direction = p.direction
                  and s2.descr = p.descr
      group by 1,2,3,4,5
    ),
    ranked as (
      select c.id, tr.keep,
             row_number() over (
               partition by c.acct, c.value_date, c.amount_minor, c.direction, c.descr
               order by (c.matched_payment_id is null), c.created_at, c.id
             ) as rn
      from counted c
      join truth tr on tr.acct = c.acct and tr.value_date = c.value_date
                   and tr.amount_minor = c.amount_minor
                   and tr.direction = c.direction and tr.descr = c.descr
    )
    delete from bank_transactions where id in (select id from ranked where rn > keep)
  `);

  /*
    ── إعادة الترقيم ──

    `occurrence` جزءٌ من المفتاح، فلا يجوز أن تبقى فيه ثغرة: صفٌّ باقٍ
    ترتيبُه ١ وقد حُذف صاحب الصفر يعني أنّ استيراداً قادماً سيكتب
    الصفر فلا يصطدم بشيء — فتعود الحركة مرّتين.

    وعلى مرحلتين لأنّ الفهرس فريد: تُزاح كلّها أوّلاً إلى مدىً خالٍ،
    ثمّ تُنزَل مرتَّبةً. ولو رُقّمت مرّةً واحدة لاصطدم صفٌّ نازلٌ بصفٍّ
    لم يتحرّك بعد.
  */
  await db.execute(sql`update bank_transactions set occurrence = occurrence + 100000`);
  const renumbered = await db.execute(sql`
    with r as (
      select t.id,
             row_number() over (
               partition by coalesce(t.bank_account_id, '~'), t.value_date, t.amount_minor,
                            t.direction,
                            upper(btrim(regexp_replace(coalesce(t.description,''), '\s+', ' ', 'g')))
               order by (t.matched_payment_id is null), i.created_at, t.id
             ) - 1 as occ
      from bank_transactions t join bank_imports i on i.id = t.bank_import_id
    )
    update bank_transactions t set occurrence = r.occ from r where t.id = r.id
  `);

  const after = (await db.execute<{ n: number }>(sql`
    select count(*)::int as n from bank_transactions
  `)).rows[0];
  console.log(`✓ حُذف ${res.rowCount} · أُعيد ترقيم ${renumbered.rowCount} · بقي ${after.n}`);

  await byOperationRef();
  process.exit(0);
}

/**
 * الشوط الثاني: من تطابق مرجعُ عمليّته تطابقت عمليّته.
 *
 * ويُحسَب في TypeScript لا في SQL، لأنّ الدالّة واحدة: يكتب بها
 * المستورِد ويقرأ بها هذا. ولو كُتب هنا استخراجٌ ثانٍ بصيغةٍ أخرى
 * لافترق الفاحصُ عن الكاتب — وهو أصل العطب الذي أدخل الكشف مرّتين.
 */
async function byOperationRef() {
  const rows = (await db.execute<{
    id: string; v: string; a: number; d: string; descr: string | null;
    ty: string | null; pay: string | null; acct: string; imp_at: string;
  }>(sql`
    select t.id, t.value_date::text as v, t.amount_minor as a, t.direction::text as d,
           t.description as descr, t.transaction_type as ty, t.matched_payment_id as pay,
           coalesce(t.bank_account_id, '~') as acct, i.created_at::text as imp_at
    from bank_transactions t join bank_imports i on i.id = t.bank_import_id
  `)).rows;

  const refOf = new Map<string, string>();
  const groups = new Map<string, typeof rows>();

  for (const r of rows) {
    const ref = operationRef(toCanonical({
      valueDate: new Date(r.v), description: r.descr, transactionType: r.ty,
      amountMinor: Number(r.a), direction: r.d as "DEBIT" | "CREDIT",
    }));
    if (!ref) continue;
    refOf.set(r.id, ref);
    const key = `${r.acct}\u0000${ref}`;
    const g = groups.get(key) ?? [];
    g.push(r);
    groups.set(key, g);
  }

  const doomed: string[] = [];
  const blocked: typeof rows[] = [];

  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const paid = g.filter((r) => r.pay !== null);
    /*
      نسختان كلتاهما مرتبطة بدفعة ليستا مسألةَ تكرار: هما دفعتان
      قُيّدتا على حوالةٍ واحدة. وحذفُ إحداهما يترك دفعةً بلا أثرٍ
      بنكيّ، ونسبُ المال قرارُ إنسان. فتُعرَض ولا تُحذف.
    */
    if (paid.length > 1) { blocked.push(g); continue; }
    const keep = paid[0] ?? [...g].sort((x, y) =>
      x.imp_at.localeCompare(y.imp_at) || x.id.localeCompare(y.id))[0];
    for (const r of g) if (r.id !== keep.id) doomed.push(r.id);
  }

  const sum = doomed.reduce((n, id) =>
    n + Number(rows.find((r) => r.id === id)?.a ?? 0), 0);

  console.log(`\n── مرجع العمليّة ──`);
  console.log(`حركات لها مرجع        ${refOf.size}`);
  console.log(`نسخٌ زائدة            ${doomed.length}  (${(sum / 100).toFixed(2)} ريال)`);
  if (blocked.length > 0) {
    console.log(`موقوفة                ${blocked.length} مجموعة — نسختاها مرتبطتان بدفعتين:`);
    for (const g of blocked) {
      console.log(`   ${g[0].v.slice(0, 10)} · ${(Number(g[0].a) / 100).toFixed(2)} · ${(g[0].descr ?? "").slice(0, 50).replace(/\s+/g, " ")}`);
      for (const r of g) console.log(`      ${r.id} → دفعة ${r.pay ?? "—"}`);
    }
  }

  if (!APPLY) {
    console.log("\nعرضٌ فقط.");
    return;
  }

  if (doomed.length > 0) {
    const CHUNK = 200;
    for (let i = 0; i < doomed.length; i += CHUNK) {
      await db.delete(bankTransactions)
        .where(inArray(bankTransactions.id, doomed.slice(i, i + CHUNK)));
    }
  }

  /*
    ثمّ تُكتَب المراجع — بعد الحذف، وإلّا ردّها القيد الفريد.

    والموقوفة تُترَك بلا مرجع: نسختان لعمليّةٍ واحدة لا يقبلهما القيد،
    وكتابتُه لإحداهما ادّعاءٌ بأنّ الأخرى عمليّةٌ ثانية. فيبقى العمود
    فارغاً حتى يحسم إنسانٌ أيَّ الدفعتين تخصّها — والفراغ هنا يقول
    «لم يُحسَم»، وهو الحقّ.
  */
  let written = 0;
  const gone = new Set(doomed);
  const held = new Set(blocked.flat().map((r) => r.id));
  for (const [id, ref] of refOf) {
    if (gone.has(id) || held.has(id)) continue;
    await db.update(bankTransactions)
      .set({ operationRef: ref })
      .where(eq(bankTransactions.id, id));
    written++;
  }
  console.log(`✓ حُذف ${doomed.length} · كُتب المرجع لـ${written} حركة · تُركت ${held.size} بلا مرجع (موقوفة)`);
}

main();
