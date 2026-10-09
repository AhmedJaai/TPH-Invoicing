/**
 * قياس: كم ملفّاً في الأرشيف يُقرأ رمزُه الضريبيّ (QR)؟ وكم يحمل XML مضمَّناً؟
 *
 *   npm run measure:zatca                 ← كلّ مستندٍ له ملفّ في الدرايف
 *   npm run measure:zatca -- --limit 40
 *   npm run measure:zatca -- --kind TAX_INVOICE
 *
 * **للقراءة فقط**: ينزّل الملفّ ويفحصه في الذاكرة. لا يكتب في القاعدة ولا في
 * الدرايف، ولا يستدعي نموذجاً — فلا كلفة ولا يخرج ملفٌّ إلى أحد.
 *
 * ── لماذا ──
 *
 * فكُّ الرمز مختبَرٌ على رموزٍ مولَّدة (صورة نظيفة · JPEG · PDF متّجه). ومسحُ
 * الجوّال الباهت والمطويّ شيءٌ آخر، ولا يُعرف نصيبُه من الأرشيف إلّا بقياسه.
 * «من يبني طبقةً يشغّلها على البيانات القائمة».
 *
 * ── وما يُخرجه ──
 *
 *   ١. نسبة ما فُكّ رمزُه، مقسومةً بالنوع وبمصدر القراءة (نصّ · صورة).
 *   ٢. تدقيقٌ رجعيّ: كلّ فاتورةٍ مقيَّدة يخالف إجماليُّها أو ضريبتُها رمزَها —
 *      أي خطأ قراءةٍ مرّ، أو فاتورةٌ عُدّلت. **يُعرض ولا يُصحَّح** (القيد ٦).
 *   ٣. كم ملفّاً يحمل مرفق XML (فاتورة المرحلة الثانية PDF/A-3) — ليُقرَّر
 *      أيستحقّ قارئ UBL أن يُبنى.
 *   ٤. كم ملفّاً «نصّيّاً» نصُّه في الحقيقة طبقةُ ماسحٍ مخفيّة.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { downloadFile, driveFromEnv } from "@/lib/drive";
import { hasHiddenOcrLayer } from "@/lib/ai/document-input";
import { mapWithConcurrency } from "@/lib/ai/deepseek";
import { readZatcaQr } from "@/lib/extraction/zatca-qr";
import { formatRiyals, TOTAL_ROUNDING_TOLERANCE_MINOR } from "@/lib/money";
import { todayInRiyadh } from "@/lib/riyadh-time";

interface Row {
  id: string;
  file_name: string;
  drive_file_id: string;
  mime_type: string;
  kind: string | null;
  text_source: string | null;
  invoice_number: string | null;
  total_minor: number | null;
  vat_minor: number | null;
  supplier_name: string | null;
  supplier_vat: string | null;
}

interface Tally { files: number; found: number; notZatca: number; none: number; skipped: number }
const blank = (): Tally => ({ files: 0, found: 0, notZatca: 0, none: 0, skipped: 0 });

function tallyFor(map: Map<string, Tally>, key: string): Tally {
  let tally = map.get(key);
  if (!tally) {
    tally = blank();
    map.set(key, tally);
  }
  return tally;
}

/** أسماء مرفقات XML في الـPDF — فارغةٌ إن لم يكن PDF أو لا مرفق. */
async function xmlAttachments(data: Buffer, mimeType: string): Promise<string[]> {
  if (mimeType !== "application/pdf") return [];
  try {
    const { getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(data));
    try {
      const attachments: unknown = await pdf.getAttachments();
      if (!attachments || typeof attachments !== "object") return [];
      return Object.keys(attachments).filter((name) => /\.xml$/i.test(name));
    } finally {
      await pdf.destroy().catch(() => undefined);
    }
  } catch {
    return [];
  }
}

function pct(part: number, whole: number): string {
  return whole === 0 ? "—" : `${((part * 1000) / whole / 10).toFixed(1)}%`;
}

async function main() {
  const args = process.argv.slice(2);
  const limitAt = args.indexOf("--limit");
  const limit = limitAt >= 0 ? Number(args[limitAt + 1]) : 2000;
  const kindAt = args.indexOf("--kind");
  const kind = kindAt >= 0 ? args[kindAt + 1] : null;

  /* العمود "created_at" لا "uploaded_at" — مساعد now() يسمّيه كذلك */
  const rows = (
    await db.execute(sql`
      select d.id, d.file_name, d.drive_file_id, d.mime_type, d.kind::text as kind, d.text_source,
             i.invoice_number, i.total_minor, i.vat_minor,
             s.name_ar as supplier_name, s.vat_number as supplier_vat
      from documents d
      left join invoices i on i.document_id = d.id
      left join suppliers s on s.id = d.supplier_id
      where d.drive_file_id is not null
        and d.status::text <> 'REJECTED'
        ${kind ? sql`and d.kind::text = ${kind}` : sql``}
      order by d.created_at desc
      limit ${limit}
    `)
  ).rows as unknown as Row[];

  console.log(`الملفّات المفحوصة: ${rows.length} — للقراءة فقط، بلا نموذج`);
  if (rows.length === 0) return;

  const drive = driveFromEnv();
  const byKind = new Map<string, Tally>();
  const bySource = new Map<string, Tally>();
  const all = blank();
  const downloadFailed: string[] = [];
  const withXml: string[] = [];
  const hiddenOcr: string[] = [];
  /** فواتير مقيَّدة يخالفها رمزُها */
  const mismatches: { file: string; invoice: string | null; field: string; recorded: string; qr: string }[] = [];
  /** مورّدون يُعرف رقمُهم الضريبيّ من الرمز ولا رقمَ مسجَّلاً لهم */
  const vatLearnable = new Map<string, string>();
  let invoicesWithQr = 0;
  let invoicesAgreeing = 0;

  let done = 0;
  await mapWithConcurrency(rows, 3, async (row) => {
    let file: { data: Buffer; mimeType: string };
    try {
      file = await downloadFile(drive, row.drive_file_id);
    } catch (e) {
      downloadFailed.push(`${row.file_name} — ${(e as Error).message}`);
      console.error(`  [${++done}/${rows.length}] ✗ تنزيل: ${row.file_name.slice(0, 44)}`);
      return;
    }
    const mimeType = file.mimeType || row.mime_type;
    const reading = await readZatcaQr(file.data, mimeType);

    const kindKey = row.kind ?? "UNKNOWN";
    const sourceKey = row.text_source ?? "غير معروف";
    for (const tally of [all, tallyFor(byKind, kindKey), tallyFor(bySource, sourceKey)]) {
      tally.files++;
      if (reading.status === "FOUND") tally.found++;
      else if (reading.status === "NOT_ZATCA") tally.notZatca++;
      else if (reading.status === "NONE") tally.none++;
      else tally.skipped++;
    }

    const xml = await xmlAttachments(file.data, mimeType);
    if (xml.length > 0) withXml.push(`${row.file_name} — ${xml.join("، ")}`);
    if (mimeType === "application/pdf" && row.text_source === "TEXT" && (await hasHiddenOcrLayer(file.data))) {
      hiddenOcr.push(row.file_name);
    }

    if (reading.status === "FOUND") {
      const q = reading.facts;
      if (row.supplier_name && !row.supplier_vat && q.sellerVatNumber) vatLearnable.set(row.supplier_name, q.sellerVatNumber);
      if (row.total_minor !== null) {
        invoicesWithQr++;
        let agrees = true;
        if (q.totalMinor !== null && Math.abs(q.totalMinor - row.total_minor) > TOTAL_ROUNDING_TOLERANCE_MINOR) {
          agrees = false;
          mismatches.push({ file: row.file_name, invoice: row.invoice_number, field: "الإجماليّ", recorded: formatRiyals(row.total_minor), qr: formatRiyals(q.totalMinor) });
        }
        if (q.vatMinor !== null && row.vat_minor !== null && Math.abs(q.vatMinor - row.vat_minor) > TOTAL_ROUNDING_TOLERANCE_MINOR) {
          agrees = false;
          mismatches.push({ file: row.file_name, invoice: row.invoice_number, field: "الضريبة", recorded: formatRiyals(row.vat_minor), qr: formatRiyals(q.vatMinor) });
        }
        if (row.supplier_vat && q.sellerVatNumber && row.supplier_vat.replace(/\s+/g, "") !== q.sellerVatNumber) {
          agrees = false;
          mismatches.push({ file: row.file_name, invoice: row.invoice_number, field: "رقم البائع الضريبيّ", recorded: row.supplier_vat, qr: q.sellerVatNumber });
        }
        if (agrees && q.totalMinor !== null) invoicesAgreeing++;
      }
    }
    console.error(`  [${++done}/${rows.length}] ${reading.status === "FOUND" ? "✓" : "·"} ${reading.status.padEnd(9)} ${row.file_name.slice(0, 48)}`);
  });

  const line = (label: string, t: Tally) =>
    `  ${label.padEnd(22)} ${String(t.files).padStart(4)} ملفّاً · فُكّ رمزُه ${String(t.found).padStart(4)} (${pct(t.found, t.files)}) · رمزٌ لغير الفاتورة ${t.notZatca} · لا رمز قُرئ ${t.none} · لم يُفحص ${t.skipped}`;

  console.log(`\n── رمز الفاتورة الضريبيّ (QR) ──`);
  console.log(line("الكلّ", all));
  console.log(`\n  بالنوع:`);
  for (const [k, t] of [...byKind.entries()].sort((a, b) => b[1].files - a[1].files)) console.log(line(k, t));
  console.log(`\n  بمصدر القراءة:`);
  for (const [k, t] of [...bySource.entries()].sort((a, b) => b[1].files - a[1].files)) console.log(line(k, t));

  console.log(`\n── تدقيقٌ رجعيّ: الفواتير المقيَّدة مقابل رموزها ──`);
  console.log(`  فواتير مقيَّدة فُكّ رمزُها : ${invoicesWithQr}`);
  console.log(`  يطابقها رمزُها            : ${invoicesAgreeing} (${pct(invoicesAgreeing, invoicesWithQr)})`);
  console.log(`  خلافاتٌ تستحقّ النظر      : ${mismatches.length} — تُعرض ولا يُصحَّح شيء`);
  for (const m of mismatches.slice(0, 40)) {
    console.log(`  · ${m.file.slice(0, 50)} (${m.invoice ?? "بلا رقم"}) — ${m.field}: المقيَّد ${m.recorded} · الرمز ${m.qr}`);
  }

  console.log(`\n── مورّدون بلا رقمٍ ضريبيّ مسجَّل ورمزُ فاتورتهم ينطق به: ${vatLearnable.size} ──`);
  for (const [name, vat] of vatLearnable) console.log(`  · ${name}: ${vat}`);

  console.log(`\n── ملفّاتٌ تحمل XML مضمَّناً (PDF/A-3): ${withXml.length} من ${all.files} ──`);
  for (const f of withXml.slice(0, 20)) console.log(`  · ${f}`);

  console.log(`\n── ملفّاتٌ قُيِّدت «نصّاً» ونصُّها طبقةُ ماسحٍ مخفيّة: ${hiddenOcr.length} ──`);
  for (const f of hiddenOcr.slice(0, 20)) console.log(`  · ${f}`);

  if (downloadFailed.length > 0) {
    console.log(`\n── تعذّر تنزيلُه: ${downloadFailed.length} ──`);
    for (const f of downloadFailed.slice(0, 10)) console.log(`  · ${f}`);
  }

  /* إلى مجلّدٍ متجاهَل — لا إلى جذر المستودع */
  mkdirSync(".bench", { recursive: true });
  const out = `.bench/zatca-${todayInRiyadh()}.json`;
  writeFileSync(out, JSON.stringify({
    files: all, byKind: Object.fromEntries(byKind), bySource: Object.fromEntries(bySource),
    invoicesWithQr, invoicesAgreeing, mismatches, vatLearnable: Object.fromEntries(vatLearnable),
    withXml, hiddenOcr, downloadFailed,
  }, null, 2));
  console.log(`\nالتفصيل في ${out}`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
