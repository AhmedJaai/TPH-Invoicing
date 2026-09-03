/**
 * قراءة كشف الحساب البنكي.
 *
 * مبنيّ على صيغة البنك الأهلي (SNB): التاريخ · نوع العملية · الوصف ·
 * المبلغ · العملة · الرصيد. والمبلغ السالب صادر والموجب وارد.
 *
 * القراءة متسامحة مع اختلاف الأعمدة: نتعرّف على الرؤوس بأسمائها لا بمواضعها،
 * فلو غيّر البنك ترتيب أعمدته لم ينكسر الاستيراد.
 */
import * as XLSX from "xlsx";
import { parseRiyals } from "@/lib/money";

export interface BankRow {
  /** رقم الصف في الملف، لتتبّع مصدر أي خطأ */
  rowNumber: number;
  valueDate: Date;
  transactionType: string;
  description: string;
  amountMinor: number;
  direction: "DEBIT" | "CREDIT";
  balanceMinor?: number;
  /** المرجع المستخرج من الوصف إن وُجد */
  reference?: string;
}

export interface ParseWarning {
  rowNumber: number;
  reason: string;
  raw: string;
}

export interface BankStatementParse {
  bank: string;
  accountNumber?: string;
  rows: BankRow[];
  warnings: ParseWarning[];
  periodStart?: Date;
  periodEnd?: Date;
}

/** رؤوس الأعمدة بصيغها العربية والإنجليزية. */
const HEADERS: Record<string, string[]> = {
  date: ["date", "التاريخ", "value date", "تاريخ العملية"],
  type: ["transaction type", "نوع العملية", "type", "نوع الحركة"],
  description: ["description", "الوصف", "البيان", "details"],
  amount: ["amount", "المبلغ", "قيمة العملية"],
  balance: ["balance", "الرصيد"],
  debit: ["debit", "مدين", "صادر"],
  credit: ["credit", "دائن", "وارد"],
};

function matchHeader(cell: string): string | null {
  const v = cell.trim().toLowerCase();
  if (!v) return null;
  for (const [key, forms] of Object.entries(HEADERS)) {
    if (forms.some((f) => v === f || v.startsWith(f))) return key;
  }
  return null;
}

/** التاريخ في كشوف البنوك السعودية: DD/MM/YYYY، وقد يتبعه وقت في سطر ثانٍ. */
export function parseBankDate(raw: string): Date | null {
  const first = raw.split(/[\n\r]/)[0].trim();
  const m = first.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m.map(Number);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const dt = new Date(Date.UTC(y, mo - 1, d));
    return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt : null;
  }
  const iso = first.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(`${first}T00:00:00Z`);
  return null;
}

/** يستخرج المرجع من وصف الحركة — أرقام طويلة أو رمز تحويل. */
export function extractReference(description: string): string | undefined {
  const flat = description.replace(/[\n\r]+/g, " ");
  const long = flat.match(/\b\d{6,}\b/g);
  return long?.[0];
}

export function parseBankStatement(
  buffer: Buffer,
  options: { bank?: string } = {},
): BankStatementParse {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" });

  const warnings: ParseWarning[] = [];
  let accountNumber: string | undefined;

  // البحث عن صفّ الرؤوس، ورقم الحساب في ما قبله
  let headerRow = -1;
  let map: Record<string, number> = {};

  for (let i = 0; i < Math.min(grid.length, 40); i++) {
    const cells = (grid[i] ?? []).map((c) => String(c ?? ""));
    const acct = cells.join(" ").match(/\b(\d{10,})\b/);
    if (acct && !accountNumber) accountNumber = acct[1];

    const found: Record<string, number> = {};
    cells.forEach((c, idx) => {
      const key = matchHeader(c);
      if (key && found[key] === undefined) found[key] = idx;
    });

    if (found.date !== undefined && (found.amount !== undefined || found.debit !== undefined)) {
      headerRow = i;
      map = found;
      break;
    }
  }

  if (headerRow === -1) {
    return {
      bank: options.bank ?? "غير محدَّد",
      accountNumber,
      rows: [],
      warnings: [{ rowNumber: 0, reason: "لم يُعثر على صفّ الرؤوس — تأكّد أنّ الملف كشف حساب", raw: "" }],
    };
  }

  const rows: BankRow[] = [];

  for (let i = headerRow + 1; i < grid.length; i++) {
    const cells = (grid[i] ?? []).map((c) => String(c ?? "").trim());
    if (cells.every((c) => !c)) continue;

    const rawDate = cells[map.date] ?? "";
    const valueDate = parseBankDate(rawDate);
    if (!valueDate) {
      // صفوف الإجماليات والتذييل لا تحمل تاريخاً — نتخطّاها بصمت
      if (rawDate) warnings.push({ rowNumber: i + 1, reason: "تاريخ غير مقروء", raw: rawDate });
      continue;
    }

    let amountMinor: number | null = null;
    let direction: "DEBIT" | "CREDIT" = "DEBIT";

    if (map.amount !== undefined) {
      const raw = (cells[map.amount] ?? "").replace(/[٬,\s]/g, "");
      const negative = raw.startsWith("-") || /^\(.*\)$/.test(raw);
      const parsed = parseRiyals(raw.replace(/[()-]/g, ""));
      if (parsed !== null) {
        amountMinor = Math.abs(parsed);
        direction = negative ? "DEBIT" : "CREDIT";
      }
    } else {
      const debit = parseRiyals((cells[map.debit] ?? "").replace(/[٬,\s]/g, ""));
      const credit = parseRiyals((cells[map.credit] ?? "").replace(/[٬,\s]/g, ""));
      if (debit && debit !== 0) { amountMinor = Math.abs(debit); direction = "DEBIT"; }
      else if (credit && credit !== 0) { amountMinor = Math.abs(credit); direction = "CREDIT"; }
    }

    if (amountMinor === null || amountMinor === 0) {
      warnings.push({
        rowNumber: i + 1,
        reason: "مبلغ غير مقروء",
        raw: cells.slice(0, 6).join(" | "),
      });
      continue;
    }

    const description = (cells[map.description] ?? "").replace(/[\n\r]+/g, " ").trim();
    const balanceRaw = map.balance !== undefined ? (cells[map.balance] ?? "").replace(/[٬,\s]/g, "") : "";
    const balanceMinor = balanceRaw ? (parseRiyals(balanceRaw) ?? undefined) : undefined;

    rows.push({
      rowNumber: i + 1,
      valueDate,
      transactionType: (cells[map.type] ?? "").replace(/[\n\r]+/g, " ").trim(),
      description,
      amountMinor,
      direction,
      balanceMinor,
      reference: extractReference(description),
    });
  }

  const dates = rows.map((r) => r.valueDate.getTime());

  return {
    bank: options.bank ?? "الأهلي (SNB)",
    accountNumber,
    rows,
    warnings,
    periodStart: dates.length ? new Date(Math.min(...dates)) : undefined,
    periodEnd: dates.length ? new Date(Math.max(...dates)) : undefined,
  };
}
