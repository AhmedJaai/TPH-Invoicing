/**
 * قياس المزوّدين على مستندات المقهى الحقيقية.
 *
 *   npm run bench:extraction              ← كل ما له حقيقةٌ مؤكَّدة
 *   npm run bench:extraction -- --limit 20
 *   npm run bench:extraction -- --kind TAX_INVOICE
 *   npm run bench:extraction -- --no-suppliers   ← بلا قائمة المورّدين في الموجِّه (للمقارنة)
 *   npm run bench:extraction -- --all            ← وما قُيِّد آلياً أيضاً — **ليس حقيقةً بشريّة**
 *
 * ── لماذا لا يحتاج هذا القياس أن يُوسَم شيءٌ بيد ──
 *
 * الحقيقة موجودة أصلاً. جدول `invoices` يحمل ما **أقرّه أحمد** بعد
 * المراجعة: رقم الفاتورة وتاريخها وصافيها وضريبتها وإجماليها. وهي
 * حقيقةٌ بشرية لا مخرَجُ نموذج — فالقياس عليها قياسٌ على الواقع.
 *
 * و`documents.extraction_json` يحمل ما قرأه **جيميني** وقتها. فالمقارنة
 * ثلاثية بلا عملٍ إضافي:
 *
 *     ما أقرّه أحمد   ←  الحقيقة
 *     extraction_json ←  جيميني
 *     نداءٌ جديد      ←  ديب سيك
 *
 * ── والحقيقة ما أقرّه إنسان وحده ──
 *
 * منذ ٢٤ سبتمبر ٢٠٢٦ تُقيَّد فواتيرُ آلياً من قراءة النموذج نفسه. فقياسُ النموذج
 * عليها قياسٌ له بما كتبه — «المقياس لا يقيس نفسه بنفسه». فتُقصَر الحقيقة على
 * ما له في سجلّ التدقيق أثرُ إنسان: أرشفةٌ من شاشة الرفع، أو قيدٌ بيد، أو تصحيحُ حقل.
 *
 * ── والمعيار واحد ──
 *
 * المقارنة كلُّها في `src/lib/extraction/benchmark.ts` (`scoreProvider`): كان هنا
 * منطقٌ ثانٍ بقواعد أخرى، و«الخطأ الواثق» المطبوع كان الخطأَ ÷ الكلّ بلا نظرٍ إلى ثقة.
 *
 * ── وما لا يُقاس يُعلَن أنّه لا يُقاس ──
 *
 * ٣٢ مستنداً من ١٥٨ بلا فاتورةٍ مؤكَّدة (كشوفٌ وإيصالات وعروض أسعار).
 * تُستبعَد من حساب الدقّة ولا تُعدّ خطأً — ولا تُعدّ صواباً أيضاً.
 * والبوّابة التي تعدّ غير المفحوص ناجحاً تُنتج ثقةً بلا سند.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { downloadFile, driveFromEnv } from "@/lib/drive";
import { extractDocument, activeProviderName } from "@/lib/extraction";
import {
  formatBenchmark, predictionFromReading, scoreProvider,
  type GroundTruth, type Prediction,
} from "@/lib/extraction/benchmark";
import { PROMPT_VERSION, SCHEMA_VERSION } from "@/lib/extraction/versions";
import { parseRiyals } from "@/lib/money";
import { estimateCostUsd } from "@/lib/ai/models";
import { mapWithConcurrency } from "@/lib/ai/deepseek";
import { todayInRiyadh } from "@/lib/riyadh-time";

interface Row {
  id: string;
  file_name: string;
  drive_file_id: string;
  mime_type: string;
  kind: string | null;
  extraction_json: unknown;
  extraction_model: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  subtotal_minor: number | null;
  vat_minor: number | null;
  total_minor: number | null;
  supplier_name_ar: string | null;
  supplier_name_en: string | null;
}

function truthOf(row: Row): GroundTruth {
  return {
    documentId: row.id,
    kind: row.kind ?? "",
    supplierName: row.supplier_name_ar ?? row.supplier_name_en ?? undefined,
    supplierAliases: row.supplier_name_ar && row.supplier_name_en ? [row.supplier_name_en] : [],
    invoiceNumber: row.invoice_number ?? undefined,
    invoiceDate: row.invoice_date?.slice(0, 10),
    subtotalMinor: row.subtotal_minor ?? undefined,
    vatMinor: row.vat_minor ?? undefined,
    totalMinor: row.total_minor ?? undefined,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const limitAt = args.indexOf("--limit");
  const limit = limitAt >= 0 ? Number(args[limitAt + 1]) : 1000;
  const kindAt = args.indexOf("--kind");
  const kind = kindAt >= 0 ? args[kindAt + 1] : null;
  const includeAuto = args.includes("--all");
  const withSuppliers = !args.includes("--no-suppliers");

  /*
    الترتيب على العمود "created_at" لا "uploaded_at" — مساعد now() يسمّيه كذلك.
    والحقيقة البشريّة: أثرٌ في سجلّ التدقيق بفاعلٍ إنسان على المستند أو فاتورته.
  */
  const rows = (
    await db.execute(sql`
      select d.id, d.file_name, d.drive_file_id, d.mime_type, d.kind::text as kind,
             d.extraction_json, d.extraction_model,
             i.invoice_number, i.invoice_date::text as invoice_date,
             i.subtotal_minor, i.vat_minor, i.total_minor,
             s.name_ar as supplier_name_ar, s.name_en as supplier_name_en
      from documents d
      join invoices i on i.document_id = d.id
      left join suppliers s on s.id = i.supplier_id
      where i.total_minor is not null
        and d.drive_file_id is not null
        ${kind ? sql`and d.kind::text = ${kind}` : sql``}
        ${includeAuto ? sql`` : sql`and exists (
          select 1 from audit_logs a
          where a.actor_id is not null
            and (
              (a.entity_type = 'document' and a.entity_id = d.id
                 and a.action in ('DOCUMENT_ARCHIVED', 'DOCUMENT_RECORDED_BY_HAND'))
              or (a.entity_type = 'invoice' and a.entity_id = i.id
                 and a.action = 'INVOICE_FIELDS_CORRECTED')
            )
        )`}
      order by d.created_at desc
      limit ${limit}
    `)
  ).rows as unknown as Row[];

  console.log(
    `المستندات المقيسة: ${rows.length} · المزوّد قيد القياس: ${activeProviderName()} · ` +
    (includeAuto ? "الحقيقة: كلُّ ما قُيِّد (ومنه الآليّ — ليست بشريّةً كلُّها)" : "الحقيقة: ما أقرّه إنسان وحده"),
  );
  if (rows.length === 0) {
    console.log("لا يُقاس: لا فاتورةَ بحقيقةٍ بشريّة — لا تُعرض دقّةٌ على عيّنةٍ فارغة.");
    return;
  }

  /* الموجِّه المقيس هو موجِّه الإنتاج: قائمة المورّدين «الاسم (slug)» كما يمرّرها /api/analyze */
  const supplierNames = withSuppliers
    ? ((await db.execute(sql`select name_ar, slug from suppliers order by name_ar`)).rows as unknown as { name_ar: string; slug: string }[])
        .map((r) => `${r.name_ar} (${r.slug})`)
    : [];
  console.log(`قائمة المورّدين في الموجِّه: ${withSuppliers ? supplierNames.length : "بلا قائمة (--no-suppliers)"}`);

  const drive = driveFromEnv();
  const truths = rows.map(truthOf);
  const stored: Prediction[] = [];
  const fresh: Prediction[] = [];
  let totalMs = 0, inTok = 0, outTok = 0, unresolved = 0;
  const failed: string[] = [];

  /*
    بتزامنٍ محدود لا بـ`Promise.all`: مئةُ اتّصالٍ معاً يردّ المزوّد ٤٢٩ على أكثرها.
    والتقدّم إلى `stderr` لأنّ `stdout` يُخزَّن حين يُوجَّه إلى ملفّ.
  */
  let done = 0;
  await mapWithConcurrency(rows, 4, async (row) => {
    /* ما حُفظ وقتها — يُقاس بلا نداء */
    stored.push(predictionFromReading(row.extraction_json, {
      documentId: row.id, provider: "المحفوظ", model: row.extraction_model ?? "غير معروف",
      promptVersion: "وقت القراءة", schemaVersion: "وقت القراءة", durationMs: 0,
    }, parseRiyals));

    const meta = {
      documentId: row.id, provider: activeProviderName(), model: "",
      promptVersion: PROMPT_VERSION, schemaVersion: SCHEMA_VERSION, durationMs: 0,
    };
    let file: { data: Buffer; mimeType: string };
    try {
      file = await downloadFile(drive, row.drive_file_id);
    } catch (e) {
      failed.push(`${row.file_name} — تعذّر التنزيل: ${(e as Error).message}`);
      fresh.push({ ...meta, failed: true });
      console.error(`  [${++done}/${rows.length}] ✗ تنزيل: ${row.file_name.slice(0, 44)}`);
      return;
    }

    const t0 = Date.now();
    const out = await extractDocument({
      data: file.data,
      /* نوعُ الملفّ من الدرايف لا من قيدنا — القيد قد يكون كُتب خطأً */
      mimeType: file.mimeType || row.mime_type,
      companyVat: process.env.COMPANY_VAT_NUMBER ?? "310007971600003",
      companyName: process.env.COMPANY_NAME_AR ?? "مؤسسة ذا بوبليك هاوس",
      supplierNames,
    });
    const durationMs = Date.now() - t0;
    totalMs += durationMs;

    if (!out.ok) {
      failed.push(`${row.file_name} — ${out.reason}`);
      fresh.push({ ...meta, durationMs, failed: true });
      console.error(`  [${++done}/${rows.length}] ✗ ${row.file_name.slice(0, 40)}: ${out.reason.slice(0, 44)}`);
      return;
    }

    inTok += out.usage?.inputTokens ?? 0;
    outTok += out.usage?.outputTokens ?? 0;
    if ((out.evidence?.unresolvedConflicts.length ?? 0) > 0) unresolved++;
    /*
      ما سدّه رمزُ الفاتورة أو الحساب ليس قراءةَ النموذج — يُفرَّغ قبل القياس فلا
      يُنسَب إليه ما لم يقرأه.
    */
    const read: Record<string, unknown> = { ...out.value };
    for (const key of Object.keys(out.evidence?.provenance ?? {})) read[key] = "";
    fresh.push(predictionFromReading(read, { ...meta, model: out.model, durationMs }, parseRiyals));
    console.error(`  [${++done}/${rows.length}] ✓ ${row.file_name.slice(0, 48)}`);
  });

  const n = rows.length;
  const before = scoreProvider(truths, stored);
  const now = scoreProvider(truths, fresh);
  console.log(formatBenchmark(`المحفوظ وقتها (${n} مستنداً)`, before));
  console.log(formatBenchmark(`الآن (${n} مستنداً)`, now));

  console.log(`\n── التشغيل ──`);
  console.log(`  فشلَ الاستخراج    : ${failed.length} من ${n} (${((failed.length / n) * 100).toFixed(1)}%)`);
  console.log(`  تعارضٌ بقي بعد إعادة السؤال: ${unresolved}`);
  console.log(`  الزمن المتوسّط    : ${(totalMs / n / 1000).toFixed(1)} ثانية للمستند`);
  console.log(`  الرموز            : دخل ${inTok} · خرج ${outTok}`);
  console.log(`  الكلفة التقديرية  : ${estimateCostUsd("VISION", { inputTokens: inTok, outputTokens: outTok }).toFixed(4)}$ للدفعة`);

  if (failed.length > 0) {
    console.log(`\n── ما لم يُقرأ ──`);
    for (const f of failed.slice(0, 15)) console.log(`  · ${f}`);
  }

  /* إلى مجلّدٍ متجاهَل — لا إلى جذر المستودع */
  mkdirSync(".bench", { recursive: true });
  const out = `.bench/extraction-${activeProviderName()}-${todayInRiyadh()}.json`;
  writeFileSync(out, JSON.stringify({ humanTruthOnly: !includeAuto, withSuppliers, n, before, now, failed, unresolved, totalMs, inTok, outTok }, null, 2));
  console.log(`\nالتفصيل في ${out}`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
