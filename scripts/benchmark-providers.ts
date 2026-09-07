/**
 * قياس المزوّدين على مستندات المقهى الحقيقية.
 *
 *   npm run bench:extraction              ← كل ما له حقيقةٌ مؤكَّدة
 *   npm run bench:extraction -- --limit 20
 *   npm run bench:extraction -- --kind STATEMENT
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
 * ── وما لا يُقاس يُعلَن أنّه لا يُقاس ──
 *
 * ٣٢ مستنداً من ١٥٨ بلا فاتورةٍ مؤكَّدة (كشوفٌ وإيصالات وعروض أسعار).
 * تُستبعَد من حساب الدقّة ولا تُعدّ خطأً — ولا تُعدّ صواباً أيضاً.
 * والبوّابة التي تعدّ غير المفحوص ناجحاً تُنتج ثقةً بلا سند.
 */
import { writeFileSync } from "node:fs";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { downloadFile, driveFromEnv } from "@/lib/drive";
import { extractDocument, activeProviderName } from "@/lib/extraction";
import { findConflicts } from "@/lib/extraction/validate-extraction";
import { parseRiyals } from "@/lib/money";
import { estimateCostUsd } from "@/lib/ai/models";
import { mapWithConcurrency } from "@/lib/ai/deepseek";

interface Row {
  id: string;
  file_name: string;
  drive_file_id: string;
  mime_type: string;
  kind: string | null;
  extraction_json: unknown;
  invoice_number: string | null;
  invoice_date: string | null;
  subtotal_minor: number | null;
  vat_minor: number | null;
  total_minor: number | null;
  supplier_name_ar: string | null;
  supplier_name_en: string | null;
}

/** الحقول المقيسة — وكلٌّ يُقاس على حدة فيُعرَف أين يقع الضعف. */
type Field = "invoiceNumber" | "invoiceDate" | "subtotal" | "vat" | "total" | "supplier";
const FIELDS: Field[] = ["invoiceNumber", "invoiceDate", "subtotal", "vat", "total", "supplier"];

interface Score {
  right: number;
  wrong: number;
  /** لم يُقرأ الحقل أصلاً — وهو غير الخطأ: الفراغ يُراجَع والخطأ يُصدَّق. */
  missing: number;
  /** لا حقيقة عندنا لهذا الحقل — فلا يُحسَب في الاتجاهين. */
  unmeasured: number;
}

const blank = (): Record<Field, Score> =>
  Object.fromEntries(FIELDS.map((f) => [f, { right: 0, wrong: 0, missing: 0, unmeasured: 0 }])) as Record<Field, Score>;

const norm = (s: string) => s.normalize("NFKC").replace(/\s+/g, "").toLowerCase();

/**
 * قراءةٌ مرنة لمخرَجٍ محفوظ.
 *
 * `extractionSchema.safeParse` كان يُسقط **كلّ** ما حفظه جيميني: ١٢٦
 * من ١٢٦ «لم تُقرأ»، فخرج المقياس بصفرٍ في كلّ حقل. وليس في المحفوظ
 * عطب — فيه `"invoiceNumber":"260138"` و`"totalAmount":"165.00"` — بل
 * تنقصه ثلاثةُ حقولٍ أُضيفت إلى المخطّط بعده (`openingBalance`
 * و`closingBalance` و`statementLines`).
 *
 * فكان المقياس يقيس **تطوّر مخطّطنا** ويعرضه ضعفاً في المزوّد. وصفرٌ
 * كهذا يُصدَّق لأنّه يوافق ما نتوقّعه، وذلك أخطر ما فيه.
 *
 * فتُقرأ الحقول المقيسة وحدها، ولا يُشترَط مخطّطٌ كامل.
 */
type Loose = Partial<Record<
  "invoiceNumber" | "invoiceDate" | "subtotalAmount" | "vatAmount" | "totalAmount" |
  "supplierNameAr" | "supplierNameEn", unknown>>;

function loose(raw: unknown): Loose | null {
  if (raw === null || raw === undefined) return null;
  const o = typeof raw === "string" ? JSON.parse(raw) : raw;
  return o && typeof o === "object" ? (o as Loose) : null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/** يقارن قراءةً بالحقيقة، حقلاً حقلاً. */
function judge(x: Loose | null, truth: Row, into: Record<Field, Score>) {
  const check = (f: Field, got: string | null, want: string | null) => {
    if (want === null || want === "") { into[f].unmeasured++; return; }
    if (x === null || got === null || got.trim() === "") { into[f].missing++; return; }
    if (norm(got) === norm(want)) into[f].right++;
    else into[f].wrong++;
  };

  const minor = (v: unknown) => {
    const t = str(v);
    if (t === null) return null;
    const m = parseRiyals(t);
    return m === null ? null : String(m);
  };

  /*
    الصفر المؤكَّد والحقل الفارغ يتّفقان.

    فاتورةٌ بلا بند ضريبة يقيّدها أحمد صفراً، والنموذج يترك الحقل
    فارغاً لأنّه لم يُطبَع. وهما قولٌ واحد: «لا ضريبة هنا». وعدُّ ذلك
    نقصاً يُنقص الدقّة عن غير حقّ ويُخفي الضعف الحقيقيّ إن وقع.
  */
  const money = (f: Field, got: string | null, wantMinor: number | null) => {
    if (wantMinor === null) { into[f].unmeasured++; return; }
    if (wantMinor === 0 && got === null) { into[f].right++; return; }
    check(f, got, String(wantMinor));
  };

  /*
    الاشتقاق يُطبَّق على الطرفين.

    `extractDocument` يشتقّ الصافي لديب سيك، فلو لم يُشتقّ لجيميني
    لقُورن مزوّدٌ بعد المعالجة بمزوّدٍ قبلها. والمقياس الذي يُعامل
    طرفيه بقاعدتين لا يقيس شيئاً.
  */
  let subtotalRead = minor(x?.subtotalAmount);
  if (subtotalRead === null) {
    const t = minor(x?.totalAmount);
    const v = minor(x?.vatAmount);
    if (t !== null && v !== null && Number(t) - Number(v) >= 0) {
      subtotalRead = String(Number(t) - Number(v));
    }
  }

  check("invoiceNumber", str(x?.invoiceNumber), truth.invoice_number);
  check("invoiceDate", str(x?.invoiceDate), truth.invoice_date?.slice(0, 10) ?? null);
  money("subtotal", subtotalRead, truth.subtotal_minor);
  money("vat", minor(x?.vatAmount), truth.vat_minor);
  money("total", minor(x?.totalAmount), truth.total_minor);
  /*
    المورّد يُقاس على اسميه معاً.

    المسجَّل عندنا اسمان — عربيّ وإنجليزيّ — والفاتورة قد تحمل أحدهما.
    فمطابقةُ الإنجليزيّ بالعربيّ تعدّ صواباً خطأً، وذلك يُنقص الدقّة
    عن غير حقّ ويُخفي الضعف الحقيقيّ إن وقع.
  */
  const wantAr = truth.supplier_name_ar;
  const wantEn = truth.supplier_name_en;
  if (!wantAr && !wantEn) {
    into.supplier.unmeasured++;
  } else {
    const got = [str(x?.supplierNameAr), str(x?.supplierNameEn)].filter((v): v is string => v !== null);
    if (x === null || got.length === 0) into.supplier.missing++;
    else {
      const wants = [wantAr, wantEn].filter((v): v is string => Boolean(v));
      /* يكفي أن يلتقي طرفٌ بطرف — والاحتواء لأنّ المطبوع يحمل «مؤسسة» و«المحدودة» */
      const hit = got.some((g) =>
        wants.some((w) => norm(g) === norm(w) || norm(g).includes(norm(w)) || norm(w).includes(norm(g))),
      );
      if (hit) into.supplier.right++;
      else into.supplier.wrong++;
    }
  }
}

function table(label: string, s: Record<Field, Score>): string {
  const lines = [`\n── ${label} ──`];
  let R = 0, W = 0, M = 0;
  for (const f of FIELDS) {
    const { right, wrong, missing, unmeasured } = s[f];
    const measured = right + wrong + missing;
    const pct = measured === 0 ? "—" : `${((right / measured) * 100).toFixed(1)}%`;
    lines.push(
      `  ${f.padEnd(14)} صحيح ${String(right).padStart(3)} · خطأ ${String(wrong).padStart(3)} · ` +
      `لم يُقرأ ${String(missing).padStart(3)} · لا حقيقة ${String(unmeasured).padStart(3)} → ${pct}`,
    );
    R += right; W += wrong; M += missing;
  }
  const total = R + W + M;
  lines.push(`  ${"الإجمالي".padEnd(14)} ${total === 0 ? "—" : `${((R / total) * 100).toFixed(1)}%`}  ` +
    `(الخطأ الواثق ${total === 0 ? "—" : `${((W / total) * 100).toFixed(1)}%`})`);
  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const limitAt = args.indexOf("--limit");
  const limit = limitAt >= 0 ? Number(args[limitAt + 1]) : 1000;
  const kindAt = args.indexOf("--kind");
  const kind = kindAt >= 0 ? args[kindAt + 1] : null;

  /*
    الترتيب على العمود "created_at" لا "uploaded_at".

    مساعد now() يسمّي كل عمود "created_at" مهما كان اسم الحقل في
    TypeScript، فحقل documents.uploadedAt عموده "created_at". مصيدةٌ
    مكتوبةٌ في CLAUDE.md ووقعتُ فيها.
  */
  const rows = (
    await db.execute(sql`
      select d.id, d.file_name, d.drive_file_id, d.mime_type, d.kind::text as kind,
             d.extraction_json,
             i.invoice_number, i.invoice_date::text as invoice_date,
             i.subtotal_minor, i.vat_minor, i.total_minor,
             s.name_ar as supplier_name_ar, s.name_en as supplier_name_en
      from documents d
      join invoices i on i.document_id = d.id
      left join suppliers s on s.id = i.supplier_id
      where i.total_minor is not null
        ${kind ? sql`and d.kind::text = ${kind}` : sql``}
      order by d.created_at desc
      limit ${limit}
    `)
  ).rows as unknown as Row[];

  console.log(`المستندات المقيسة: ${rows.length} · المزوّد قيد القياس: ${activeProviderName()}`);
  if (rows.length === 0) return;

  const drive = driveFromEnv();
  const now = blank();
  const before = blank();

  let conflicts = 0, failures = 0, totalMs = 0, inTok = 0, outTok = 0;
  const failed: string[] = [];

  /*
    بتزامنٍ محدود لا بـ`Promise.all`.

    مئةٌ وستّة وعشرون مستنداً في وقتٍ واحد تفتح مئةً وستّاً وعشرين
    اتصالاً، فيردّ المزوّد ٤٢٩ على أكثرها — فيبدو العطب «حدّ طلبات»
    وهو سوء إدارةٍ عندنا. وأربعةٌ تكفي: الزمن يقصر أربع مرّات ولا
    يُضغَط على المزوّد.

    والتقدّم يُكتَب إلى `stderr` لأنّ `stdout` يُخزَّن حين يُوجَّه إلى
    ملفّ، فلا يُرى شيءٌ حتى ينتهي كلّ شيء.
  */
  let done = 0;
  await mapWithConcurrency(rows, 4, async (row) => {
    /* ما قرأه جيميني وقتها — يُقاس بلا نداء */
    judge(loose(row.extraction_json), row, before);

    let file: { data: Buffer; mimeType: string };
    try {
      file = await downloadFile(drive, row.drive_file_id);
    } catch (e) {
      failures++;
      failed.push(`${row.file_name} — تعذّر التنزيل: ${(e as Error).message}`);
      judge(null, row, now);
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
      supplierNames: [],
    });
    totalMs += Date.now() - t0;

    if (!out.ok) {
      failures++;
      failed.push(`${row.file_name} — ${out.reason}`);
      judge(null, row, now);
      console.error(`  [${++done}/${rows.length}] ✗ ${row.file_name.slice(0, 40)}: ${out.reason.slice(0, 44)}`);
      return;
    }

    inTok += out.usage?.inputTokens ?? 0;
    outTok += out.usage?.outputTokens ?? 0;
    if (findConflicts(out.value).length > 0) conflicts++;
    judge(out.value as Loose, row, now);
    console.error(`  [${++done}/${rows.length}] ✓ ${row.file_name.slice(0, 48)}`);
  });

  const n = rows.length;
  console.log(table(`جيميني — المحفوظ وقتها (${n} مستنداً)`, before));
  console.log(table(`${activeProviderName()} — الآن (${n} مستنداً)`, now));

  console.log(`\n── التشغيل ──`);
  console.log(`  فشلَ الاستخراج    : ${failures} من ${n} (${((failures / n) * 100).toFixed(1)}%)`);
  console.log(`  تعارضٌ حسابيّ باقٍ: ${conflicts}`);
  console.log(`  الزمن الوسيط      : ${(totalMs / n / 1000).toFixed(1)} ثانية للمستند`);
  console.log(`  الرموز            : دخل ${inTok} · خرج ${outTok}`);
  console.log(`  الكلفة التقديرية  : ${estimateCostUsd("VISION", { inputTokens: inTok, outputTokens: outTok }).toFixed(4)}$ للدفعة`);

  if (failed.length > 0) {
    console.log(`\n── ما لم يُقرأ ──`);
    for (const f of failed.slice(0, 15)) console.log(`  · ${f}`);
  }

  const out = `bench-${activeProviderName()}-${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(out, JSON.stringify({ provider: activeProviderName(), n, before, now, failures, conflicts, totalMs, inTok, outTok }, null, 2));
  console.log(`\nالتفصيل في ${out}`);
}

main().then(() => process.exit(0));
