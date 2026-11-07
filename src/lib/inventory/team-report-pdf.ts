/**
 * تقريرُ جرد السبت ملفَّ PDF — ما يرسله الموظّفُ للإدارة واتساب (أحمد، ٨ نوفمبر ٢٠٢٦: «خلّي التقرير
 * يكون PDF ويكون مرتّب»).
 *
 * يُرسَم في الخادم بـSkia (`@napi-rs/canvas` · `PDFDocument`) بخطّ التطبيق نفسه (ثمانية)، فالعربيّةُ
 * موصولةٌ من اليمين ونصُّها نصٌّ لا صورة. صفحاتُ A4: رأسٌ بالشعار والأسبوع، وملخّص، وجدولٌ بالفئة
 * فيه كلُّ صنفٍ في النطاق — المعدودُ بكمّيّته، وما لم يُعَدّ يُقال «لم يُعَدّ» لا صفراً.
 */
import path from "node:path";
import { GlobalFonts, PDFDocument, loadImage, type Image } from "@napi-rs/canvas";

type Ctx = ReturnType<PDFDocument["beginPage"]>;
import { PRODUCT, countNoun } from "../arabic";
import type { ReportLine } from "./team-report";

const W = 595;
const H = 842;
const M = 40;
const ROW = 21;
const OLIVE = "#5A5444";
const INK = "#1f1d18";
const MUTED = "#8a857a";
const LINE = "#e4e0d6";
const SUNKEN = "#f3f0e8";

let fontsReady = false;
function ensureFonts() {
  if (fontsReady) return;
  const dir = path.join(process.cwd(), "src/fonts");
  GlobalFonts.registerFromPath(path.join(dir, "thmanyahsans-Regular.woff2"), "TPHSans");
  GlobalFonts.registerFromPath(path.join(dir, "thmanyahsans-Bold.woff2"), "TPHSansBold");
  fontsReady = true;
}

const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const dayText = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };

type Row = { kind: "group"; label: string; counted: number; total: number; cont?: boolean } | { kind: "item"; line: ReportLine; zebra: boolean };

/** الصفوفُ بفئاتها بترتيب الجرد — وكلُّ فئةٍ تبدأ بسطرها. */
function rowsOf(lines: readonly ReportLine[]): Row[] {
  const out: Row[] = [];
  const groups = [...new Set(lines.map((l) => l.categoryLabel))];
  for (const g of groups) {
    const items = lines.filter((l) => l.categoryLabel === g);
    out.push({ kind: "group", label: g, counted: items.filter((l) => l.counted !== null).length, total: items.length });
    items.forEach((line, i) => out.push({ kind: "item", line, zebra: i % 2 === 1 }));
  }
  return out;
}

function fit(ctx: Ctx, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

export interface TeamReportPdfInput {
  week: { start: string; end: string };
  by: string;
  lines: readonly ReportLine[];
  /** وقتُ الإعداد بتوقيت الرياض نصّاً («الأحد 8 نوفمبر، 1:11 ص»). */
  preparedAt: string;
}

export async function teamCountReportPdf(input: TeamReportPdfInput): Promise<Buffer> {
  ensureFonts();
  let logo: Image | null = null;
  try { logo = await loadImage(path.join(process.cwd(), "public/icons/icon-192.png")); } catch { /* بلا شعار يبقى التقرير */ }

  const counted = input.lines.filter((l) => l.counted !== null).length;
  const rows = rowsOf(input.lines);

  /* التقسيمُ على الصفحات أوّلاً — ليُكتب «صفحة ١ من ٣» */
  const FIRST_TOP = 236;
  const TOP = 96;
  const BOTTOM = H - 64;
  const pages: Row[][] = [[]];
  let y = FIRST_TOP + ROW;
  let group: Extract<Row, { kind: "group" }> | null = null;
  for (const r of rows) {
    if (r.kind === "group") group = r;
    /* سطرُ الفئة لا يبقى وحده في ذيل الصفحة */
    const need = r.kind === "group" ? ROW * 2 : ROW;
    if (y + need > BOTTOM) {
      pages.push([]);
      y = TOP + ROW;
      /* فئةٌ تعبر الصفحة تُعاد بـ«(تابع)» — لا صنفَ بلا فئته في رأس الصفحة */
      if (r.kind === "item" && group) { pages[pages.length - 1].push({ ...group, cont: true }); y += ROW; }
    }
    pages[pages.length - 1].push(r);
    y += ROW;
  }

  const doc = new PDFDocument({ title: `جرد السبت ${input.week.start} – ${input.week.end}`, author: input.by, creator: "TPH Team" });
  const right = W - M;
  const left = M;
  const qtyX = left + 150;

  pages.forEach((page, p) => {
    const ctx = doc.beginPage(W, H);
    ctx.direction = "rtl";
    ctx.textBaseline = "middle";

    /* ── الرأس ── */
    ctx.fillStyle = OLIVE;
    ctx.fillRect(0, 0, W, 6);
    if (p === 0) {
      /* لوحُ PDF يرسم الصورة، ونوعُه في المكتبة لا يذكرها — يُسأل عنها لا يُفرض */
      if (logo && "drawImage" in ctx && typeof ctx.drawImage === "function") ctx.drawImage(logo, right - 48, 30, 48, 48);
      ctx.textAlign = "right";
      ctx.fillStyle = INK;
      ctx.font = "22px TPHSansBold";
      ctx.fillText("تقرير جرد السبت", right - 60, 46);
      ctx.fillStyle = MUTED;
      ctx.font = "12px TPHSans";
      ctx.fillText("ذا بوبليك هاوس · النسيم، جدة", right - 60, 68);
      ctx.textAlign = "left";
      ctx.fillStyle = INK;
      ctx.font = "13px TPHSansBold";
      ctx.fillText(`من ${dayText(input.week.start)}`, left, 46);
      ctx.fillText(`إلى ${dayText(input.week.end)}`, left, 66);

      /* ── الملخّص: صفّان × خانتان، فلا يُقصّ اسمٌ ولا وقت ── */
      const boxY = 96;
      ctx.fillStyle = SUNKEN;
      ctx.fillRect(left, boxY, right - left, 104);
      const cells: [string, string, boolean][] = [
        ["عدّه", input.by, false],
        ["ما عُدّ", `${counted} من ${countNoun(input.lines.length, PRODUCT)}`, false],
        ["أُعدّ التقرير", input.preparedAt, false],
        ["لم يُعَدّ", input.lines.length - counted === 0 ? "لا شيء — عُدّ كلّه" : countNoun(input.lines.length - counted, PRODUCT), counted < input.lines.length],
      ];
      const cw = (right - left) / 2;
      cells.forEach(([label, value, warn], i) => {
        const x = right - (i % 2) * cw - 14;
        const cy = boxY + 26 + Math.floor(i / 2) * 50;
        ctx.textAlign = "right";
        ctx.fillStyle = MUTED;
        ctx.font = "11px TPHSans";
        ctx.fillText(label, x, cy);
        ctx.fillStyle = warn ? "#9a4d00" : INK;
        ctx.font = "13px TPHSansBold";
        ctx.fillText(fit(ctx, value, cw - 28), x, cy + 20);
      });
    } else {
      ctx.textAlign = "right";
      ctx.fillStyle = MUTED;
      ctx.font = "11px TPHSans";
      ctx.fillText(`تقرير جرد السبت · ${dayText(input.week.start)} – ${dayText(input.week.end)}`, right, 40);
    }

    /* ── رأسُ الجدول ── */
    let ry = p === 0 ? FIRST_TOP : TOP;
    ctx.fillStyle = OLIVE;
    ctx.fillRect(left, ry - ROW / 2, right - left, ROW);
    ctx.fillStyle = "#ffffff";
    ctx.font = "11px TPHSansBold";
    ctx.textAlign = "right";
    ctx.fillText("الصنف", right - 10, ry);
    ctx.textAlign = "left";
    ctx.fillText("الكمية المعدودة", left + 10, ry);
    ry += ROW;

    for (const r of page) {
      if (r.kind === "group") {
        ctx.fillStyle = SUNKEN;
        ctx.fillRect(left, ry - ROW / 2, right - left, ROW);
        ctx.fillStyle = OLIVE;
        ctx.font = "12px TPHSansBold";
        ctx.textAlign = "right";
        ctx.fillText(r.cont ? `${r.label} (تابع)` : r.label, right - 10, ry);
        ctx.fillStyle = MUTED;
        ctx.font = "10px TPHSans";
        ctx.textAlign = "left";
        ctx.fillText(`${r.counted} من ${r.total}`, left + 10, ry);
      } else {
        if (r.zebra) { ctx.fillStyle = "#faf8f3"; ctx.fillRect(left, ry - ROW / 2, right - left, ROW); }
        ctx.strokeStyle = LINE;
        ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(left, ry + ROW / 2); ctx.lineTo(right, ry + ROW / 2); ctx.stroke();
        ctx.textAlign = "right";
        ctx.fillStyle = INK;
        ctx.font = "12px TPHSans";
        ctx.fillText(fit(ctx, r.line.name, right - qtyX - 20), right - 10, ry);
        ctx.textAlign = "left";
        if (r.line.counted !== null) {
          ctx.font = "12px TPHSansBold";
          ctx.fillText(r.line.counted, left + 10, ry);
        } else {
          ctx.fillStyle = "#9a4d00";
          ctx.font = "11px TPHSans";
          ctx.fillText("لم يُعَدّ", left + 10, ry);
        }
      }
      ry += ROW;
    }

    /* ── التذييل ── */
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(left, H - 40); ctx.lineTo(right, H - 40); ctx.stroke();
    ctx.fillStyle = MUTED;
    ctx.font = "10px TPHSans";
    ctx.textAlign = "right";
    ctx.fillText("أُعدّ من TPH Team — والإقفال في «الجرد الحالي»", right, H - 26);
    ctx.textAlign = "left";
    ctx.fillText(`صفحة ${p + 1} من ${pages.length}`, left, H - 26);
    doc.endPage();
  });

  return doc.close();
}
