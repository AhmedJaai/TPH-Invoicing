/**
 * أوراقٌ مكتوبة ← ملفّ Excel. من اليمين إلى اليسار، والمالُ خلايا عدديّة بتنسيق المال فيجمعها
 * المحاسب، والمجهولُ نصٌّ فلا يُجمع صفراً. وللورقة الجدوليّة ترشيحٌ على صفّ عناوينها، وعرضُ
 * العمود من أطول خليّةٍ فيه — كان المحاسبُ يضيفهما بيده كلَّ شهر.
 */
import * as XLSX from "xlsx";
import type { Cell, Sheet } from "./accountant-pack";

function toCell(c: Cell): XLSX.CellObject {
  if (typeof c === "string") return { t: "s", v: c };
  if ("count" in c) return { t: "n", v: c.count, z: "0" };
  /* النصُّ «1234.50» مكتوبٌ من هللاتٍ صحيحة — والعددُ هنا لإكسل وحده */
  return { t: "n", v: Number(c.riyals), z: "#,##0.00" };
}

const textOf = (c: Cell): string => (typeof c === "string" ? c : "count" in c ? String(c.count) : c.riyals);

const MIN_WIDTH = 10;
const MAX_WIDTH = 48;

export function sheetsToWorkbook(sheets: readonly Sheet[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  for (const s of sheets) {
    const ws: XLSX.WorkSheet = {};
    const widths: number[] = [];
    s.rows.forEach((row, r) => {
      row.forEach((cell, c) => {
        ws[XLSX.utils.encode_cell({ r, c })] = toCell(cell);
        widths[c] = Math.max(widths[c] ?? MIN_WIDTH, Math.min(MAX_WIDTH, textOf(cell).length + 2));
      });
    });
    const lastCol = Math.max(0, widths.length - 1);
    const ref = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, s.rows.length - 1), c: lastCol } });
    ws["!ref"] = ref;
    ws["!cols"] = Array.from({ length: lastCol + 1 }, (_, c) => ({ wch: widths[c] ?? MIN_WIDTH }));
    /* ورقةٌ جدوليّة: صفُّها الأوّل عناوينُ بعرض الورقة كلِّها، وتحته صفوف */
    if (s.rows.length > 1 && (s.rows[0]?.length ?? 0) > 2 && s.rows[0].length === widths.length) ws["!autofilter"] = { ref };
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  return wb;
}

export function sheetsToXlsx(sheets: readonly Sheet[]): Uint8Array {
  const out: unknown = XLSX.write(sheetsToWorkbook(sheets), { type: "buffer", bookType: "xlsx" });
  if (!(out instanceof Uint8Array)) throw new Error("تعذّرت كتابة الملفّ");
  return new Uint8Array(out);
}
