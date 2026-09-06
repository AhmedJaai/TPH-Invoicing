/**
 * قراءة كشف الحساب البنكي.
 *
 * مبنيّ على صيغة البنك الأهلي (SNB): التاريخ · نوع العملية · الوصف ·
 * المبلغ · العملة · الرصيد. والمبلغ السالب صادر والموجب وارد.
 *
 * القراءة متسامحة مع اختلاف الأعمدة: نتعرّف على الرؤوس بأسمائها لا بمواضعها،
 * فلو غيّر البنك ترتيب أعمدته لم ينكسر الاستيراد.
 */
import { readWorkbookSafely } from "./parsers/safe-xlsx";
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
  /**
   * المستفيد كما كتبه البنك في عموده.
   *
   * كان القارئ لا يبحث عن هذا العمود أصلاً، فبقي فارغاً في كل حركة —
   * وعليه يقوم تعريف المستفيد. فكان المحرّك يقرأ الاسم من داخل الوصف
   * إن وُجد، ويعجز إن لم يوجد.
   */
  beneficiaryRaw?: string;
  /** تاريخ القيد، إن كان في الكشف عمودٌ له غير تاريخ العملية. */
  postingDate?: Date;
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
  date: ["date", "التاريخ", "value date", "تاريخ العملية", "تاريخ العمليه", "trx date"],
  postingDate: ["posting date", "تاريخ القيد", "book date"],
  type: ["transaction type", "نوع العملية", "نوع العمليه", "type", "نوع الحركة"],
  description: ["description", "الوصف", "البيان", "details", "narrative", "تفاصيل"],
  /*
    عمود المستفيد. يختلف اسمه بين صيغ التصدير، ولذلك تُذكر صيغه كلّها —
    وغيابه هو ما جعل تعريف المستفيد يعتمد على نبش الاسم من داخل الوصف.
  */
  beneficiary: [
    "beneficiary", "المستفيد", "اسم المستفيد", "beneficiary name",
    "الطرف الآخر", "الطرف الاخر", "counterparty", "payee", "المرسل اليه",
  ],
  amount: ["amount", "المبلغ", "قيمة العملية", "قيمه العمليه"],
  balance: ["balance", "الرصيد", "الرصيد بعد العملية"],
  debit: ["debit", "مدين", "صادر", "مسحوبات"],
  credit: ["credit", "دائن", "وارد", "ايداعات", "إيداعات"],
};

/** يوحّد رأس العمود قبل المطابقة: الهمزة والتاء المربوطة والفراغات. */
function normalizeHeader(cell: string): string {
  return cell
    .replace(/[ً-ْـ]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function matchHeader(cell: string): string | null {
  const v = normalizeHeader(cell);
  if (!v) return null;
  /*
    الأطول أوّلاً: «تاريخ القيد» يجب ألّا يُلتقَط بـ«التاريخ»، و«اسم
    المستفيد» ألّا يُلتقَط بصيغة أقصر تسبقه في الترتيب.
  */
  const entries = Object.entries(HEADERS)
    .flatMap(([key, forms]) => forms.map((f) => ({ key, form: normalizeHeader(f) })))
    .sort((a, b) => b.form.length - a.form.length);

  for (const { key, form } of entries) {
    if (v === form || v.startsWith(form)) return key;
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


interface HeaderLocation {
  headerRow: number;
  map: Record<string, number>;
  accountNumber?: string;
}

/**
 * يبحث عن صفّ الرؤوس داخل ورقة، وعن رقم الحساب فيما قبله.
 *
 * ويُقبَل الصفّ حين يحمل تاريخاً ومبلغاً — أو تاريخاً وعمودَي مدين
 * ودائن — فهذا أقلّ ما يصلح كشفَ حساب.
 */
function locateHeader(grid: readonly string[][]): HeaderLocation {
  let accountNumber: string | undefined;

  for (let i = 0; i < Math.min(grid.length, HEADER_SEARCH_ROWS); i++) {
    const cells = (grid[i] ?? []).map((c) => String(c ?? ""));

    const acct = cells.join(" ").match(/\b(\d{10,})\b/);
    if (acct !== null && accountNumber === undefined) accountNumber = acct[1];

    const found: Record<string, number> = {};
    cells.forEach((c, idx) => {
      const key = matchHeader(c);
      if (key !== null && found[key] === undefined) found[key] = idx;
    });

    if (found.date !== undefined && (found.amount !== undefined || found.debit !== undefined)) {
      return { headerRow: i, map: found, accountNumber };
    }
  }

  return { headerRow: -1, map: {}, accountNumber };
}

/** كم صفّاً يُفتَّش عن الرؤوس قبل اليأس — الترويسة قد تطول. */
const HEADER_SEARCH_ROWS = 60;

/**
 * يقرأ الكشف من صفوفٍ نصّية — لا من جدول.
 *
 * تُشارك `parseBankStatement` منطقَها كلّه: البحث عن الرؤوس، وقراءة
 * التواريخ والمبالغ، والتقاط المستفيد. فالفرق بين PDF وExcel في
 * **مصدر الصفوف** لا في فهمها، ولو كُتب لكلٍّ قارئ لاختلفا يوماً.
 */

/**
 * يبني الصفوف من شبكةٍ وموضعِ رؤوسها.
 *
 * مشتركةٌ بين Excel وPDF عمداً: الفرق بينهما في مصدر الشبكة لا في
 * فهمها، ولو كُتب لكلٍّ منطقٌ لاختلفا يوماً في قراءة تاريخٍ أو مبلغ.
 */
function buildRows(
  grid: readonly (readonly string[])[],
  headerRow: number,
  map: Record<string, number>,
  ctx: { bank?: string; accountNumber?: string; warnings?: ParseWarning[] },
): BankStatementParse {
  const warnings = ctx.warnings ?? [];

  if (headerRow === -1) {
    return {
      bank: ctx.bank ?? "غير محدَّد",
      accountNumber: ctx.accountNumber,
      rows: [],
      warnings: [
        ...warnings,
        { rowNumber: 0, reason: "لم يُعثر على صفّ الرؤوس — تأكّد أنّ الملف كشف حساب", raw: "" },
      ],
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
    const beneficiaryRaw = map.beneficiary !== undefined
      ? (cells[map.beneficiary] ?? "").replace(/[\n\r]+/g, " ").trim()
      : "";
    const postingDate = map.postingDate !== undefined
      ? parseBankDate(cells[map.postingDate] ?? "")
      : null;
    const balanceRaw = map.balance !== undefined
      ? (cells[map.balance] ?? "").replace(/[٬,\s]/g, "") : "";
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
      /*
        الفراغ لا يُحفَظ نصّاً فارغاً: الفرق بين «لا عمود مستفيد في
        الكشف» و«العمود موجود وفارغ» يُقرأ لاحقاً من غياب الحقل.
      */
      beneficiaryRaw: beneficiaryRaw.length > 0 ? beneficiaryRaw : undefined,
      postingDate: postingDate ?? undefined,
    });
  }

  const dates = rows.map((r) => r.valueDate.getTime());

  return {
    bank: ctx.bank ?? "الأهلي (SNB)",
    accountNumber: ctx.accountNumber,
    rows,
    warnings,
    periodStart: dates.length ? new Date(Math.min(...dates)) : undefined,
    periodEnd: dates.length ? new Date(Math.max(...dates)) : undefined,
  };
}

export function parseRowGrid(
  grid: readonly (readonly string[])[],
  options: { bank?: string; accountNumber?: string } = {},
): BankStatementParse {
  const cells = grid.map((r) => [...r]);
  const found = locateHeader(cells);
  return buildRows(cells, found.headerRow, found.map, {
    bank: options.bank,
    accountNumber: options.accountNumber ?? found.accountNumber,
  });
}

export function parseBankStatement(
  buffer: Buffer,
  options: { bank?: string } = {},
): BankStatementParse {
  /*
    القراءة عبر حرسٍ لا مباشرةً: `xlsx@0.18.5` فيه ثغرتان عاليتان بلا
    إصلاحٍ على npm، والمشروع يقرأ بها ملفّات **يرفعها مستخدم**.
    التفصيل في `parsers/safe-xlsx.ts`.
  */
  const safe = readWorkbookSafely(buffer);

  /*
    تُجرَّب الأوراق كلّها لا الأولى وحدها: بعض صيغ التصدير تضع ورقة
    غلافٍ أو ملخّصاً قبل ورقة الحركات، فقراءة الأولى تُرجع لا شيء.
    وتُختار أوّل ورقة يُعثَر فيها على صفّ رؤوس صالح.
  */
  let grid: string[][] = [];
  const warnings: ParseWarning[] = safe.warnings.map((reason, i) => ({
    rowNumber: -(i + 1), reason, raw: "",
  }));
  let accountNumber: string | undefined;
  let headerRow = -1;
  let map: Record<string, number> = {};

  for (const sheet of safe.sheets) {
    const candidate = sheet.grid;
    const found = locateHeader(candidate);
    if (found.headerRow !== -1) {
      grid = candidate;
      headerRow = found.headerRow;
      map = found.map;
      accountNumber = found.accountNumber;
      break;
    }
    if (grid.length === 0) grid = candidate;
    accountNumber ??= found.accountNumber;
  }

  return buildRows(grid, headerRow, map, {
    bank: options.bank,
    accountNumber,
    warnings,
  });
}

