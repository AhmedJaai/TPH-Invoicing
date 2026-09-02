/**
 * جرد أرشيف الدرايف — قراءة فقط، لا تعديل ولا نقل ولا حذف.
 *
 *   npm run drive:inventory
 *
 * يمشي على ACCOUNTS / <سنة> / <شهر> / <مورد> / <ملف>، يفكّك كل اسم ملف،
 * ويخرج تقريراً بما فُهم وما احتاج تدخلاً بشرياً، ويستنتج من الملفات نفسها
 * خريطة «اسم المجلد ← الاسم المختصر» وأسماء المستفيدين البنكيين.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { driveFromEnv, isFolder, listChildren, type DriveFile } from "@/lib/drive";
import { parseFileName, type ParsedFileName } from "@/lib/naming";
import { driveConfig, SERVICE_FOLDER_NAMES, SUPPLIER_INFO_CARD } from "@/config/drive";
import { formatRiyalsDisplay } from "@/lib/money";
import { KNOWN_SLUGS } from "@/lib/suppliers-seed";

interface Row {
  month: string;
  folderName: string;
  isServiceFolder: boolean;
  file: DriveFile;
  parsed?: ParsedFileName;
  problem?: string;
}

const MONTH_RE = /^\d{4}-\d{2}$/;

async function main() {
  const drive = driveFromEnv();
  const rows: Row[] = [];
  const infoCards: string[] = [];

  for (const [year, yearFolderId] of Object.entries(driveConfig.yearFolderIds)) {
    let months: DriveFile[];
    try {
      months = await listChildren(drive, yearFolderId);
    } catch (e) {
      console.error(`تعذّر قراءة مجلد سنة ${year}: ${(e as Error).message}`);
      continue;
    }

    for (const month of months.filter(isFolder)) {
      if (!MONTH_RE.test(month.name)) {
        console.warn(`تخطّي مجلد غير شهري داخل ${year}: ${month.name}`);
        continue;
      }

      for (const folder of (await listChildren(drive, month.id)).filter(isFolder)) {
        const isServiceFolder = SERVICE_FOLDER_NAMES.includes(folder.name);

        for (const file of await listChildren(drive, folder.id)) {
          if (isFolder(file)) continue;
          if (file.name === SUPPLIER_INFO_CARD) {
            infoCards.push(`${month.name}/${folder.name}`);
            continue;
          }

          const result = parseFileName(file.name, KNOWN_SLUGS);
          rows.push({
            month: month.name,
            folderName: folder.name,
            isServiceFolder,
            file,
            parsed: result.ok ? result.value : undefined,
            problem: result.ok ? undefined : result.reason,
          });
        }
      }
    }
  }

  report(rows, infoCards);
}

function report(rows: Row[], infoCards: string[]) {
  const parsed = rows.filter((r) => r.parsed);
  const failed = rows.filter((r) => !r.parsed);

  console.log(`\n${"═".repeat(62)}`);
  console.log("  جرد أرشيف الدرايف — قراءة فقط، لم يُعدَّل أي ملف");
  console.log("═".repeat(62));
  console.log(`\nإجمالي الملفات: ${rows.length}`);
  console.log(`  فُكّك اسمها بنجاح : ${parsed.length}`);
  console.log(`  تحتاج تدخلاً يدوياً: ${failed.length}`);
  console.log(`  بطاقات معلومات مورد (غير محاسبية): ${infoCards.length}`);

  // ─── حسب النوع ───
  const byKind = new Map<string, { count: number; totalMinor: number }>();
  for (const r of parsed) {
    const k = r.parsed!.kind;
    const e = byKind.get(k) ?? { count: 0, totalMinor: 0 };
    e.count++;
    e.totalMinor += r.parsed!.amountMinor;
    byKind.set(k, e);
  }
  const kindLabel: Record<string, string> = {
    INVOICE: "فواتير", STATEMENT: "كشوف", RECEIPT: "إيصالات سداد", CASH: "نقدي",
  };
  console.log(`\n── حسب النوع ──`);
  for (const [kind, e] of [...byKind].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ${(kindLabel[kind] ?? kind).padEnd(14)} ${String(e.count).padStart(4)} ملف   ${formatRiyalsDisplay(e.totalMinor).padStart(14)} ريال`);
  }

  // ─── حسب الشهر ───
  const byMonth = new Map<string, number>();
  for (const r of rows) byMonth.set(r.month, (byMonth.get(r.month) ?? 0) + 1);
  console.log(`\n── حسب الشهر ──`);
  for (const [m, c] of [...byMonth].sort()) {
    console.log(`  ${m}   ${String(c).padStart(4)} ملف`);
  }

  // ─── خريطة المجلد ← الاسم المختصر، مستنتجة من الملفات نفسها ───
  const folderToSlugs = new Map<string, Set<string>>();
  for (const r of parsed) {
    if (r.isServiceFolder || !r.parsed!.slug) continue;
    const set = folderToSlugs.get(r.folderName) ?? new Set<string>();
    set.add(r.parsed!.slug);
    folderToSlugs.set(r.folderName, set);
  }
  console.log(`\n── خريطة اسم المجلد ← الاسم المختصر (مستنتجة من الملفات) ──`);
  for (const [folder, slugs] of [...folderToSlugs].sort()) {
    const list = [...slugs];
    const flag = list.length > 1 ? "  ⚠ أكثر من اسم مختصر في مجلد واحد" : "";
    console.log(`  ${folder.padEnd(34)} ← ${list.join(", ")}${flag}`);
  }

  // ─── أسماء المستفيدين البنكيين ───
  const beneficiaries = new Map<string, Set<string>>();
  for (const r of parsed) {
    const p = r.parsed!;
    if (p.kind !== "RECEIPT" || !p.beneficiary || !p.slug) continue;
    const set = beneficiaries.get(p.slug) ?? new Set<string>();
    set.add(p.beneficiary);
    beneficiaries.set(p.slug, set);
  }
  if (beneficiaries.size > 0) {
    console.log(`\n── أسماء المستفيدين البنكية المستخرجة (أساس جدول الأسماء البديلة) ──`);
    for (const [slug, names] of [...beneficiaries].sort()) {
      console.log(`  ${slug.padEnd(20)} ← ${[...names].join(", ")}`);
    }
  }

  // ─── أسماء مختصرة غير معروفة ───
  const unknownSlugs = new Set(
    parsed.map((r) => r.parsed!.slug).filter((s): s is string => Boolean(s) && !KNOWN_SLUGS.includes(s!)),
  );
  if (unknownSlugs.size > 0) {
    console.log(`\n── ⚠ أسماء مختصرة غير مسجّلة في قائمة الموردين ──`);
    for (const s of [...unknownSlugs].sort()) console.log(`  ${s}`);
  }

  // ─── ما يحتاج تدخلاً ───
  if (failed.length > 0) {
    console.log(`\n── ⚠ ملفات لم يُفهم اسمها ──`);
    for (const r of failed) {
      console.log(`  ${r.month}/${r.folderName}/${r.file.name}`);
      console.log(`     السبب: ${r.problem}`);
    }
  }

  // ─── حفظ التقرير ───
  mkdirSync("reports", { recursive: true });
  const path = `reports/drive-inventory-${new Date().toISOString().slice(0, 19).replace(/:/g, "")}.json`;
  writeFileSync(path, JSON.stringify({
    generatedAt: new Date().toISOString(),
    totals: { files: rows.length, parsed: parsed.length, failed: failed.length, infoCards: infoCards.length },
    folderToSlug: Object.fromEntries([...folderToSlugs].map(([k, v]) => [k, [...v]])),
    beneficiaries: Object.fromEntries([...beneficiaries].map(([k, v]) => [k, [...v]])),
    unknownSlugs: [...unknownSlugs],
    rows: rows.map((r) => ({
      month: r.month, folder: r.folderName, fileName: r.file.name,
      driveFileId: r.file.id, sizeBytes: r.file.size,
      parsed: r.parsed ?? null, problem: r.problem ?? null,
    })),
  }, null, 2), "utf8");

  console.log(`\nالتقرير الكامل محفوظ في: ${path}`);
  console.log(`لم يُنشأ ولم يُعدَّل ولم يُحذف أي ملف في الدرايف.\n`);
}

main().catch((e) => { console.error("\nخطأ:", e.message); process.exit(1); });
