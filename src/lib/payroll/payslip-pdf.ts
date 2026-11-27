/**
 * قسيمةُ الراتب ملفَّ PDF — يرسلها المالك للموظّف آخرَ الشهر (أحمد، ٢٧ نوفمبر ٢٠٢٦: «قسيمةٌ لكلّ موظّف
 * أرسلها PDF، فيها كلُّ التفاصيل: كلُّ عملٍ إضافيّ وكلُّ خصم»).
 *
 * يُرسَم في الخادم بـSkia (`@napi-rs/canvas` · `PDFDocument`) بخطّ التطبيق (ثمانية) — العربيّةُ موصولةٌ
 * ونصٌّ لا صورة، كما كان تقريرُ الجرد. والرسمُ لا يحسب شيئاً: يأخذ سطوراً جاهزة من الخدمة
 * (`payslip-pdf.service.ts`) التي تبنيها من المسيّر نفسِه، فلا يخالف الملفُّ الشاشة.
 */
import path from "node:path";
import { GlobalFonts, PDFDocument, loadImage, type Image } from "@napi-rs/canvas";

type Ctx = ReturnType<PDFDocument["beginPage"]>;

const W = 595;
const H = 842;
const M = 40;
const OLIVE = "#5A5444";
const INK = "#1f1d18";
const MUTED = "#8a857a";
const LINE = "#e4e0d6";
const SUNKEN = "#f3f0e8";
const PLUS = "#2f6b3a";
const MINUS = "#9a3412";

export const SLIP_FONT_FILES = ["thmanyahsans-Regular.woff2", "thmanyahsans-Bold.woff2"] as const;
export const SLIP_LOGO = "public/icons/icon-192.png";

let fontsReady = false;
function ensureFonts() {
  if (fontsReady) return;
  const dir = path.join(process.cwd(), "src/fonts");
  const regular = GlobalFonts.registerFromPath(path.join(dir, "thmanyahsans-Regular.woff2"), "TPHSans");
  const bold = GlobalFonts.registerFromPath(path.join(dir, "thmanyahsans-Bold.woff2"), "TPHSansBold");
  /* بلا الخطّ تخرج القسيمةُ مربّعاتٍ لا عربيّة — تُرفض وتُسمع، لا تُرسَل فارغة (`outputFileTracingIncludes`) */
  if (!regular || !bold) throw new Error("خط القسيمة غير موجود على الخادم، فلم يُعدّ الملف.");
  fontsReady = true;
}

export type SlipTone = "plus" | "minus" | "muted";

export interface SlipLine {
  label: string;
  /** سطرٌ ثانٍ أصغر: السبب والبند والحساب. */
  detail?: string;
  value: string;
  tone?: SlipTone;
  strong?: boolean;
}

export interface SlipSection {
  title: string;
  lines: SlipLine[];
}

export interface SlipPdfInput {
  title: string;
  /** «مؤسسة ذا بوبليك هاوس · النسيم، جدة». */
  issuer: string;
  issuerIds: string;
  /** خاناتُ الموظّف: الاسم · المسمّى · الهويّة · الفترة. */
  employee: [string, string][];
  /** الأرقامُ الكبيرة في رأس القسيمة. */
  summary: [string, string, SlipTone?][];
  sections: SlipSection[];
  /** سجلُّ الحضور يوماً بيوم — أعمدتُه من اليمين. */
  attendance: { columns: string[]; widths: number[]; rows: { cells: string[]; muted?: boolean }[] } | null;
  notes: string[];
  issuedAt: string;
}

function fit(ctx: Ctx, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

/** يلفّ النصّ على كلماته في عرضٍ معلوم. */
function wrap(ctx: Ctx, text: string, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && ctx.measureText(next).width > max) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.length > 0 ? lines : [""];
}

const toneColor = (t?: SlipTone) => (t === "plus" ? PLUS : t === "minus" ? MINUS : t === "muted" ? MUTED : INK);

/** ما يُرسم: كتلٌ تُقاس ثمّ تُوزَّع على الصفحات. */
type Block =
  | { kind: "heading"; text: string; h: number }
  | { kind: "line"; line: SlipLine; labelLines: string[]; detailLines: string[]; zebra: boolean; h: number }
  | { kind: "tableHead"; h: number }
  | { kind: "tableRow"; cells: string[]; muted: boolean; zebra: boolean; h: number }
  | { kind: "note"; lines: string[]; h: number }
  | { kind: "gap"; h: number };

const VALUE_W = 110;
/* ارتفاعُ سطر البند — اسمٌ لا رقمٌ مكتوب (حارسُ نِسب الضريبة يقرأ «× ١٥») */
const LABEL_LINE_H = 15;

export async function payslipPdf(input: SlipPdfInput): Promise<Buffer> {
  ensureFonts();
  let logo: Image | null = null;
  try { logo = await loadImage(path.join(process.cwd(), SLIP_LOGO)); } catch { /* بلا شعار تبقى القسيمة */ }

  const doc = new PDFDocument({ title: input.title, author: "The Public House", creator: "TPH Invoicing" });
  const right = W - M;
  const left = M;
  const labelMax = right - left - VALUE_W - 24;

  /* القياسُ يحتاج لوحاً بالخطّ — صفحةٌ أولى تُستعمل للقياس ثمّ للرسم */
  let ctx = doc.beginPage(W, H);
  const blocks: Block[] = [];
  for (const sec of input.sections) {
    if (sec.lines.length === 0) continue;
    blocks.push({ kind: "gap", h: 10 }, { kind: "heading", text: sec.title, h: 24 });
    sec.lines.forEach((line, i) => {
      ctx.font = `${line.strong ? 12 : 11}px ${line.strong ? "TPHSansBold" : "TPHSans"}`;
      const labelLines = wrap(ctx, line.label, labelMax);
      ctx.font = "9px TPHSans";
      const detailLines = line.detail ? wrap(ctx, line.detail, labelMax) : [];
      blocks.push({ kind: "line", line, labelLines, detailLines, zebra: i % 2 === 1, h: 8 + labelLines.length * LABEL_LINE_H + detailLines.length * 12 + 4 });
    });
  }
  /* الشرحُ مع الأرقام، وسجلُّ الحضور ملحقٌ في الآخر */
  if (input.notes.length > 0) {
    blocks.push({ kind: "gap", h: 10 });
    ctx.font = "9px TPHSans";
    for (const n of input.notes) { const lines = wrap(ctx, `• ${n}`, right - left); blocks.push({ kind: "note", lines, h: lines.length * 12 + 3 }); }
  }
  if (input.attendance && input.attendance.rows.length > 0) {
    blocks.push({ kind: "gap", h: 14 }, { kind: "heading", text: "سجل الحضور يوماً بيوم", h: 24 }, { kind: "tableHead", h: 18 });
    input.attendance.rows.forEach((r, i) => blocks.push({ kind: "tableRow", cells: r.cells, muted: r.muted === true, zebra: i % 2 === 1, h: 17 }));
  }

  /* التوزيعُ على الصفحات — ليُكتب «صفحة ١ من ٢»، ورأسُ الجدول يُعاد في كلّ صفحة */
  /* رأسُ الصفحة الأولى: خاناتُ الموظّف ثمّ الأرقام — وما بعدها يبدأ تحتها */
  const BOX_Y = 98;
  const empRows = Math.ceil(input.employee.length / 2);
  const SUM_Y = BOX_Y + empRows * 34 + 24;
  const FIRST_TOP = SUM_Y + 74 + 6;
  const TOP = 70;
  const BOTTOM = H - 56;
  const pages: Block[][] = [[]];
  let y = FIRST_TOP;
  let inTable = false;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind === "heading") inTable = blocks[i + 1]?.kind === "tableHead";
    /* العنوانُ لا يبقى وحده في ذيل الصفحة */
    const need = b.kind === "heading" ? b.h + (blocks[i + 1]?.h ?? 0) + (blocks[i + 2]?.h ?? 0) : b.h;
    if (y + need > BOTTOM) {
      pages.push([]);
      y = TOP;
      if (b.kind === "gap") continue;
      if (inTable && b.kind === "tableRow") { pages[pages.length - 1].push({ kind: "tableHead", h: 18 }); y += 18; }
    }
    pages[pages.length - 1].push(b);
    y += b.h;
  }

  const att = input.attendance;
  /* حدودُ الأعمدة من اليمين */
  const colRight = (i: number) => {
    if (!att) return right;
    const total = att.widths.reduce((s, w) => s + w, 0);
    const scale = (right - left) / total;
    return right - att.widths.slice(0, i).reduce((s, w) => s + w, 0) * scale;
  };
  const colWidth = (i: number) => (att ? (att.widths[i] * (right - left)) / att.widths.reduce((s, w) => s + w, 0) : 0);

  pages.forEach((page, p) => {
    if (p > 0) ctx = doc.beginPage(W, H);
    ctx.direction = "rtl";
    ctx.textBaseline = "middle";
    ctx.fillStyle = OLIVE;
    ctx.fillRect(0, 0, W, 6);

    if (p === 0) {
      if (logo && "drawImage" in ctx && typeof ctx.drawImage === "function") ctx.drawImage(logo, right - 50, 28, 50, 50);
      ctx.textAlign = "right";
      ctx.fillStyle = INK;
      ctx.font = "22px TPHSansBold";
      ctx.fillText(input.title, right - 62, 44);
      ctx.fillStyle = MUTED;
      ctx.font = "11px TPHSans";
      ctx.fillText(input.issuer, right - 62, 64);
      ctx.fillText(input.issuerIds, right - 62, 79);

      /* خاناتُ الموظّف: عمودان */
      const boxY = BOX_Y;
      const rowsN = empRows;
      ctx.strokeStyle = LINE;
      ctx.lineWidth = 0.8;
      ctx.strokeRect(left, boxY, right - left, rowsN * 34 + 10);
      const cw = (right - left) / 2;
      input.employee.forEach(([label, value], i) => {
        const x = right - (i % 2) * cw - 14;
        const cy = boxY + 16 + Math.floor(i / 2) * 34;
        ctx.textAlign = "right";
        ctx.fillStyle = MUTED;
        ctx.font = "9px TPHSans";
        ctx.fillText(label, x, cy);
        ctx.fillStyle = INK;
        ctx.font = "12px TPHSansBold";
        ctx.fillText(fit(ctx, value, cw - 28), x, cy + 15);
      });

      /* الأرقامُ الكبيرة */
      const sumY = SUM_Y;
      ctx.fillStyle = SUNKEN;
      ctx.fillRect(left, sumY, right - left, 74);
      const n = input.summary.length;
      const sw = (right - left) / n;
      input.summary.forEach(([label, value, tone], i) => {
        const cx = right - i * sw - sw / 2;
        ctx.textAlign = "center";
        ctx.fillStyle = MUTED;
        ctx.font = "9px TPHSans";
        ctx.fillText(label, cx, sumY + 24);
        ctx.fillStyle = toneColor(tone);
        ctx.font = `${i === n - 1 ? 15 : 13}px TPHSansBold`;
        ctx.fillText(fit(ctx, value, sw - 8), cx, sumY + 48);
        if (i > 0) { ctx.strokeStyle = LINE; ctx.beginPath(); ctx.moveTo(right - i * sw, sumY + 12); ctx.lineTo(right - i * sw, sumY + 62); ctx.stroke(); }
      });
    } else {
      ctx.textAlign = "right";
      ctx.fillStyle = MUTED;
      ctx.font = "10px TPHSans";
      ctx.fillText(`${input.title} · ${input.employee[0]?.[1] ?? ""}`, right, 36);
    }

    let ry = p === 0 ? FIRST_TOP : TOP;
    for (const b of page) {
      switch (b.kind) {
        case "gap": break;
        case "heading": {
          ctx.textAlign = "right";
          ctx.fillStyle = OLIVE;
          ctx.font = "13px TPHSansBold";
          ctx.fillText(b.text, right, ry + 10);
          ctx.strokeStyle = OLIVE;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(left, ry + 21); ctx.lineTo(right, ry + 21); ctx.stroke();
          break;
        }
        case "line": {
          const l = b.line;
          if (l.strong) { ctx.fillStyle = SUNKEN; ctx.fillRect(left, ry, right - left, b.h); }
          else if (b.zebra) { ctx.fillStyle = "#faf8f3"; ctx.fillRect(left, ry, right - left, b.h); }
          let ty = ry + 4 + 7;
          ctx.textAlign = "right";
          ctx.fillStyle = l.tone === "muted" ? MUTED : INK;
          ctx.font = `${l.strong ? 12 : 11}px ${l.strong ? "TPHSansBold" : "TPHSans"}`;
          for (const t of b.labelLines) { ctx.fillText(t, right - 8, ty); ty += LABEL_LINE_H; }
          ctx.fillStyle = MUTED;
          ctx.font = "9px TPHSans";
          for (const t of b.detailLines) { ctx.fillText(t, right - 8, ty - 2); ty += 12; }
          ctx.textAlign = "left";
          ctx.fillStyle = toneColor(l.tone);
          ctx.font = `${l.strong ? 12 : 11}px TPHSansBold`;
          ctx.fillText(l.value, left + 8, ry + 4 + 7);
          ctx.strokeStyle = LINE;
          ctx.lineWidth = 0.5;
          ctx.beginPath(); ctx.moveTo(left, ry + b.h); ctx.lineTo(right, ry + b.h); ctx.stroke();
          break;
        }
        case "tableHead": {
          if (!att) break;
          ctx.fillStyle = OLIVE;
          ctx.fillRect(left, ry, right - left, b.h);
          ctx.fillStyle = "#ffffff";
          ctx.font = "9px TPHSansBold";
          ctx.textAlign = "right";
          att.columns.forEach((c, i) => ctx.fillText(c, colRight(i) - 5, ry + b.h / 2));
          break;
        }
        case "tableRow": {
          if (b.zebra) { ctx.fillStyle = "#faf8f3"; ctx.fillRect(left, ry, right - left, b.h); }
          ctx.textAlign = "right";
          b.cells.forEach((c, i) => {
            ctx.fillStyle = b.muted ? MUTED : INK;
            ctx.font = i === b.cells.length - 1 ? "9px TPHSansBold" : "9px TPHSans";
            ctx.fillText(fit(ctx, c, colWidth(i) - 8), colRight(i) - 5, ry + b.h / 2);
          });
          ctx.strokeStyle = LINE;
          ctx.lineWidth = 0.4;
          ctx.beginPath(); ctx.moveTo(left, ry + b.h); ctx.lineTo(right, ry + b.h); ctx.stroke();
          break;
        }
        case "note": {
          ctx.textAlign = "right";
          ctx.fillStyle = MUTED;
          ctx.font = "9px TPHSans";
          let ty = ry + 6;
          for (const t of b.lines) { ctx.fillText(t, right, ty); ty += 12; }
          break;
        }
      }
      ry += b.h;
    }

    ctx.strokeStyle = LINE;
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(left, H - 38); ctx.lineTo(right, H - 38); ctx.stroke();
    ctx.fillStyle = MUTED;
    ctx.font = "9px TPHSans";
    ctx.textAlign = "right";
    ctx.fillText(`المبالغ بالريال السعودي · صدرت ${input.issuedAt}`, right, H - 24);
    ctx.textAlign = "left";
    ctx.fillText(`صفحة ${p + 1} من ${pages.length}`, left, H - 24);
    doc.endPage();
  });

  return doc.close();
}
