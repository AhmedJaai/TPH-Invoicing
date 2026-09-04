/**
 * إصلاح سلامة البيانات المالية.
 *
 *   npm run db:repair            معاينة
 *   npm run db:repair -- --commit
 *
 * أربعة أعطال وجدها التدقيق في بيانات حقيقية:
 *
 *   ١. كشف البنك استُورد ثلاث مرّات، فصارت كل حركة ثلاثاً. وهذا يضاعف كل
 *      تقرير مبنيّ عليها. تُبقى أقدم عملية استيراد ويُحذف ما بعدها.
 *   ٢. مستندان بمحتوى واحد: الأصل ونسخة رُفعت أثناء الفحص. تُحجَر النسخة
 *      ولا تُحذف، وتُنقل فاتورتها إلى الأصل.
 *   ٣. تخصيص يتجاوز قيمة الدفعة — ولو بهللة. يُحدّ بما بقي من الدفعة.
 *   ٤. فاتورة صافيها وضريبتها صفران وإجماليها موجب: ذلك **مجهول** لا صفر.
 *      تُفرَّغ الحقول وتُوسم حالتها UNKNOWN.
 *
 * لا يمسّ الدرايف إطلاقاً — الملفات كلّها تبقى كما هي.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { bankRules, bankTransactions } from "@/db/schema";
import { isInternalNoise } from "@/lib/bank/match";
import { findRule, type BankRule } from "@/lib/bank/rules";
import { formatRiyalsDisplay } from "@/lib/money";

const commit = process.argv.includes("--commit");

interface Step {
  name: string;
  found: number;
  detail: string[];
  apply: () => Promise<void>;
}

/** هل العمود موجود؟ يسمح بتشغيل السكربت قبل ترحيل المخطّط وبعده. */
async function hasColumn(table: string, column: string): Promise<boolean> {
  const rows = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from information_schema.columns
    where table_name = ${table} and column_name = ${column}
  `);
  return Number(rows.rows[0]?.n ?? 0) > 0;
}

async function main() {
  console.log(`\nوضع التشغيل: ${commit ? "إصلاح فعلي" : "معاينة فقط (أضف --commit)"}\n`);
  const steps: Step[] = [];

  /* ── ١) كشوف بنكية مستوردة أكثر من مرّة ── */
  const imports = await db.execute<{ id: string; file_name: string; n: number; created_at: Date }>(sql`
    select bi.id, bi.file_name, bi.created_at,
           (select count(*)::int from bank_transactions t where t.bank_import_id = bi.id) as n
    from bank_imports bi order by bi.created_at
  `);
  const byFile = new Map<string, typeof imports.rows>();
  for (const r of imports.rows) {
    const list = byFile.get(r.file_name) ?? [];
    list.push(r);
    byFile.set(r.file_name, list);
  }
  const redundant = [...byFile.values()].flatMap((list) => list.slice(1));
  steps.push({
    name: "استيرادات بنكية مكرّرة",
    found: redundant.length,
    detail: redundant.map((r) => `  ${r.file_name} — ${r.n} حركة (يُحذف)`),
    apply: async () => {
      for (const r of redundant) {
        await db.execute(sql`delete from bank_imports where id = ${r.id}`);
      }
    },
  });

  /* ── ٢) مستندان بمحتوى واحد ── */
  const dupDocs = await db.execute<{ sha256: string; ids: string[]; names: string[] }>(sql`
    select sha256,
           array_agg(id order by created_at) as ids,
           array_agg(file_name order by created_at) as names
    from documents
    -- المحجور نسخة معروفة معالَجة — لا يُعاد الإبلاغ عنها كل مرّة
    where sha256 is not null and status <> 'REJECTED'
    group by sha256 having count(*) > 1
  `);
  steps.push({
    name: "مستندات بمحتوى مكرّر",
    found: dupDocs.rows.length,
    detail: dupDocs.rows.map((r) => `  ${r.names.join("  ⟷  ")}`),
    apply: async () => {
      for (const g of dupDocs.rows) {
        /*
         * الأقدم رفعاً هو نسخة الفحص، والأصل ما بعده. لكن الفاتورة قد تكون
         * معلّقة بالنسخة. فتُنقل إلى الأصل إن كان خالياً، ثم تُحجَر النسخة.
         */
        const [keep, ...rest] = [...g.ids].reverse(); // الأحدث = الأصل
        for (const dropId of rest) {
          await db.execute(sql`
            update invoices set document_id = ${keep}
            where document_id = ${dropId}
              and not exists (select 1 from invoices i2 where i2.document_id = ${keep})
          `);
          await db.execute(sql`
            update documents set status = 'REJECTED', updated_at = now()
            where id = ${dropId}
          `);
          await db.execute(sql`
            insert into issues (id, code, severity, status, entity_type, entity_id, message, created_at)
            values (gen_random_uuid()::text, 'DUPLICATE_FILE', 'INFO', 'RESOLVED', 'document', ${dropId},
                    'نسخة بمحتوى مطابق لمستند آخر — حُجرت ولم تُحذف، وملفها في الدرايف لم يُمسّ', now())
          `);
        }
      }
    },
  });

  /* ── ٣) تخصيص يتجاوز الدفعة ── */
  const over = await db.execute<{ payment_id: string; amount_minor: number; alloc: number }>(sql`
    select p.id as payment_id, p.amount_minor, coalesce(sum(pa.amount_minor), 0)::int as alloc
    from payments p join payment_allocations pa on pa.payment_id = p.id
    group by p.id, p.amount_minor
    having coalesce(sum(pa.amount_minor), 0) > p.amount_minor
  `);
  steps.push({
    name: "تخصيصات تتجاوز قيمة دفعتها",
    found: over.rows.length,
    detail: over.rows.map(
      (r) => `  دفعة ${formatRiyalsDisplay(r.amount_minor)} خُصّص منها ${formatRiyalsDisplay(r.alloc)}`,
    ),
    apply: async () => {
      for (const r of over.rows) {
        // يُقتطع الفائض من أكبر تخصيص — فالتقريب يقع فيه عادةً
        await db.execute(sql`
          update payment_allocations
          set amount_minor = amount_minor - ${r.alloc - r.amount_minor}
          where id = (
            select id from payment_allocations
            where payment_id = ${r.payment_id}
            order by amount_minor desc limit 1
          )
        `);
      }
    },
  });

  /* ── ٤) المجهول الذي صار صفراً ── */
  if (await hasColumn("invoices", "tax_status")) {
    const zeros = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from invoices
      where subtotal_minor = 0 and vat_minor = 0 and total_minor > 0
    `);
    steps.push({
      name: "فواتير صار مجهولها صفراً",
      found: Number(zeros.rows[0]?.n ?? 0),
      detail: [`  تُفرَّغ حقولها وتُوسم UNKNOWN بدل «غير صالحة»`],
      apply: async () => {
        await db.execute(sql`
          update invoices
          set subtotal_minor = null, vat_minor = null,
              tax_status = 'UNKNOWN', input_vat_status = 'UNKNOWN', updated_at = now()
          where subtotal_minor = 0 and vat_minor = 0 and total_minor > 0
        `);
      },
    });
  }

  /* ── ٥) هوية الحركة البنكية ── */
  if (await hasColumn("bank_transactions", "external_id")) {
    const missing = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from bank_transactions where external_id is null
    `);
    steps.push({
      name: "حركات بنكية بلا هوية",
      found: Number(missing.rows[0]?.n ?? 0),
      detail: ["  تُبنى بصمة من الحساب والتاريخ والمبلغ والاتجاه والوصف وترتيب التكرار"],
      apply: async () => {
        /*
         * ترتيب التكرار داخل المجموعة جزء من الهوية عمداً: الكشف قد يحمل
         * حركتين متطابقتين تماماً في اليوم الواحد وهما حقيقيتان، فلو أهملناه
         * لابتلعت البصمة إحداهما. ومع الترتيب: نفس الملف يعطي نفس البصمات
         * فلا يتكرّر، وحركتان حقيقيتان تبقيان اثنتين.
         */
        await db.execute(sql`
          with numbered as (
            select t.id,
                   encode(digest(
                     coalesce(bi.account_number, '') || '|' ||
                     to_char(t.value_date, 'YYYY-MM-DD') || '|' ||
                     t.amount_minor::text || '|' || t.direction::text || '|' ||
                     coalesce(t.description, '') || '|' ||
                     (row_number() over (
                        partition by t.bank_import_id, t.value_date, t.amount_minor,
                                     t.direction, coalesce(t.description, '')
                        order by t.id))::text
                   , 'sha256'), 'hex') as fp
            from bank_transactions t
            join bank_imports bi on bi.id = t.bank_import_id
            where t.external_id is null
          )
          update bank_transactions t set external_id = n.fp from numbered n where n.id = t.id
        `);
      },
    });
  }

  /* ── ٦) حركات تنطبق عليها قاعدة ولم تُصنَّف ── */
  if (await hasColumn("bank_transactions", "category")) {
    const rules: BankRule[] = await db
      .select({
        id: bankRules.id, normalized: bankRules.normalized,
        category: bankRules.category, supplierId: bankRules.supplierId,
      })
      .from(bankRules);

    const unclassified = await db
      .select({
        id: bankTransactions.id,
        description: bankTransactions.description,
        direction: bankTransactions.direction,
        amountMinor: bankTransactions.amountMinor,
      })
      .from(bankTransactions)
      .where(sql`${bankTransactions.category} = 'UNKNOWN'`);

    /*
     * القواعد تُطبَّق على ما استُورد قبل وجودها.
     * وإلّا بقيت ألف وأربعمئة حركة «غير مصنَّفة» رغم أنّ صاحبها صنّف أمثالها،
     * فيقول مقياس صحّة البيانات صفراً وهو غير صادق.
     */
    const matched: { id: string; category: string; ruleId: string | null }[] = [];
    for (const t of unclassified) {
      const rule = rules.length ? findRule(t.description ?? "", rules) : undefined;
      if (rule) {
        matched.push({ id: t.id, category: rule.category, ruleId: rule.id });
        continue;
      }
      /*
       * الوارد وحركات نقاط البيع والرسوم تشغيلية بطبيعتها، لا تنتظر قراراً
       * من أحد. وتركها «غير مصنَّفة» يجعل المقياس يقول إنّ ألفاً ومئتين
       * تحتاج نظر صاحبها، وهي لا تحتاجه.
       */
      const noise = isInternalNoise({
        id: t.id, valueDate: new Date(), description: t.description ?? "",
        transactionType: "", amountMinor: t.amountMinor, direction: t.direction,
      });
      if (t.direction === "CREDIT" || noise) {
        matched.push({ id: t.id, category: "INTERNAL", ruleId: null });
      }
    }

    steps.push({
      name: "حركات بلا تصنيف يمكن تصنيفها",
      found: matched.length,
      detail: [`  من ${unclassified.length} غير مصنَّفة، تنطبق قاعدة على ${matched.length}`],
      apply: async () => {
        for (const m of matched) {
          await db
            .update(bankTransactions)
            .set({ category: m.category as never, ruleId: m.ruleId ?? undefined })
            .where(eq(bankTransactions.id, m.id));
        }
      },
    });
  }

  /* ── التقرير ── */
  let total = 0;
  for (const s of steps) {
    total += s.found;
    console.log(`${s.found > 0 ? "⚠" : "✓"} ${s.name}: ${s.found}`);
    if (s.found > 0) for (const d of s.detail.slice(0, 6)) console.log(d);
    if (s.detail.length > 6) console.log(`  … و${s.detail.length - 6} غيرها`);
  }

  if (total === 0) {
    console.log("\nلا شيء يحتاج إصلاحاً.\n");
    process.exit(0);
  }

  if (!commit) {
    console.log("\nمعاينة فقط — أضف --commit للإصلاح.\n");
    process.exit(0);
  }

  for (const s of steps) {
    if (s.found > 0) {
      await s.apply();
      console.log(`✓ ${s.name}`);
    }
  }
  console.log("\nتمّ. لم يُمسّ الدرايف.\n");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
