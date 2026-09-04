/**
 * مطابقة كشف حساب المورّد بفواتيرنا.
 *
 * هذه أهمّ مطابقة في النظام كلّه، لأنّها وحدها تكشف ما لا يكشفه شيء آخر:
 * **فاتورة حمّلها المورّد على حسابنا ولم تصلنا قطّ**. الفاتورة الناقصة لا
 * تُرى في أرشيفنا مهما فتّشناه — لأنّها ليست فيه. ولا تظهر إلا حين نقابل
 * ما عندنا بما عنده.
 *
 * دوال خالصة: تأخذ سطوراً وتُرجع نتيجة. لا شبكة ولا قاعدة بيانات.
 */
import { ISSUE, ISSUE_TEXT } from "./issue-codes";
import type { Finding } from "./validation";

export interface StatementLineInput {
  date: Date;
  /** المرجع كما كتبه المورّد — رقم فاتورة غالباً */
  ref?: string | null;
  description?: string | null;
  /** ما حمّله علينا */
  debitMinor: number;
  /** ما سدّدناه */
  creditMinor: number;
}

export interface OurInvoice {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: Date;
  totalMinor: number;
}

/**
 * حالات سطر الكشف.
 *
 * كانت أربعاً، فكل ما لم يُطابَق «مفقود من الأرشيف» — والحال أغنى:
 * السطر قد يكون مكرّراً في كشف المورّد نفسه، أو إشعاراً دائناً، أو
 * سداداً لم يُنسَب، أو مطابقاً بمرجعٍ يتنازعه سطران. وكلٌّ يحتاج فعلاً
 * مختلفاً، فتسميتها كلّها «مفقودة» يُخفي ما يجب أن يُرى.
 */
export type LineStatus =
  | "MATCHED"
  | "AMOUNT_MISMATCH"
  | "DATE_MISMATCH"
  | "MISSING_FROM_ARCHIVE"
  | "DUPLICATE_LINE"
  | "REFERENCE_CONFLICT"
  | "CREDIT_NOTE"
  | "PAYMENT";

export interface LineMatch {
  line: StatementLineInput;
  status: LineStatus;
  invoice?: OurInvoice;
  /** كشفه ناقص عنّا موجب، وزائد سالب */
  differenceMinor?: number;
  /** كيف طوبق: بالرقم أوثق من بالمبلغ */
  method?: "REF" | "AMOUNT_DATE";
  /** درجة الترجيح من مئة — ليست يقيناً. */
  score?: number;
  /** لماذا طوبق هكذا، بنصّه. */
  why?: string[];
}

export interface Reconciliation {
  lines: LineMatch[];
  /** حمّلها علينا وليست في أرشيفنا — الأهمّ */
  missingFromArchive: LineMatch[];
  /** عندنا ولم ترد في كشفه */
  notInStatement: OurInvoice[];
  amountMismatches: LineMatch[];
  matchedCount: number;

  theirBilledMinor: number;
  theirPaidMinor: number;
  ourBilledMinor: number;
  /** كشفه ناقصاً عنّا موجب */
  billedDifferenceMinor: number;

  /** فحص حسابي على كشفه نفسه: افتتاحي + مدين − دائن = ختامي */
  balanceArithmeticOk: boolean | null;
  computedClosingMinor: number | null;

  findings: Finding[];
}

import { reconcile, type Claim } from "./bank/optimizer";

/** توحيد رقم الفاتورة للمقارنة: بلا رموز ولا فراغ، بحروف كبيرة. */
export function normalizeRef(value: string | null | undefined): string {
  return (value ?? "").replace(/[^\p{L}\p{N}]+/gu, "").toUpperCase();
}

/**
 * هل يدلّ مرجع الكشف على هذه الفاتورة؟
 *
 * المورّد يكتب المرجع ناقصاً أو بزيادة: «INV CIV-008205250 - توريد» مقابل
 * «CIV-008205250» عندنا. فالاحتواء في أيّ الاتجاهين يكفي، بشرط ألّا يكون
 * الرقم قصيراً فيطابق كل شيء.
 */
function refMatches(theirs: string, ours: string): boolean {
  if (!theirs || !ours) return false;
  if (theirs === ours) return true;
  if (ours.length < 4) return false;
  return theirs.includes(ours) || ours.includes(theirs);
}

const DAY = 86_400_000;

export interface ReconcileOptions {
  /** تسامح فرق المبلغ بالهللات */
  toleranceMinor?: number;
  /** أقصى فارق أيام حين تُطابَق بالمبلغ والتاريخ */
  dateWindowDays?: number;
  openingBalanceMinor?: number;
  closingBalanceMinor?: number;
}

export function reconcileStatement(
  statementLines: readonly StatementLineInput[],
  ourInvoices: readonly OurInvoice[],
  options: ReconcileOptions = {},
): Reconciliation {
  const tolerance = options.toleranceMinor ?? 1;
  const windowMs = (options.dateWindowDays ?? 7) * DAY;

  const ourByRef = ourInvoices.map((i) => ({ invoice: i, ref: normalizeRef(i.invoiceNumber) }));

  /*
    ── النواة المشتركة ──

    كان هنا `claimed` جشعٌ: أوّل سطر يجد فاتورةً يحجزها، فيُحرَم سطرٌ
    لاحقٌ أولى بها. وهي عين المشكلة التي عولجت في محرّك البنك — فلا
    يصحّ أن يُصلَح أحدهما ويُترك الآخر، ولا أن يُكتَب مطابقان مختلفان
    لعملٍ واحد.

    فتُولَّد المطالبات كلّها أوّلاً، ثمّ تُوزَّع بالدرجة عبر الكشف كلّه
    في `reconcile()` نفسها التي يستعملها البنك.
  */
  const debitLines = statementLines.filter((l) => l.debitMinor > 0);
  const claims: Claim[] = [];

  debitLines.forEach((line, lineIndex) => {
    const key = `line-${lineIndex}`;
    const theirRef = normalizeRef(line.ref ?? line.description);

    for (const o of ourByRef) {
      const byRef = theirRef.length > 0 && refMatches(theirRef, o.ref);
      const amountClose = Math.abs(o.invoice.totalMinor - line.debitMinor) <= tolerance;
      const dateClose =
        Math.abs(o.invoice.invoiceDate.getTime() - line.date.getTime()) <= windowMs;

      if (!byRef && !(amountClose && dateClose)) continue;

      /*
        المرجع أوثق دليل: المورّد كتب رقم فاتورتنا بنفسه. والمبلغ
        والتاريخ معاً أضعف — قد يجتمعان بالمصادفة في كشفٍ فيه عشرات
        الأسطر المتقاربة.
      */
      const score = byRef ? (amountClose ? 1 : 0.9) : 0.7;
      const why: string[] = [];
      if (byRef) why.push(`المورّد كتب مرجعاً يطابق رقم فاتورتنا ${o.invoice.invoiceNumber}`);
      if (amountClose) why.push("المبلغ يطابق");
      else why.push(`فرق المبلغ ${Math.abs(o.invoice.totalMinor - line.debitMinor) / 100} ريالاً`);
      if (dateClose) why.push("التاريخ ضمن النافذة");
      else why.push("التاريخ خارج النافذة");

      claims.push({
        transactionId: key,
        candidate: {
          invoiceIds: [o.invoice.invoiceId],
          outcome: amountClose ? "EXACT_INVOICE" : "AMOUNT_MISMATCH",
          allocatedMinor: line.debitMinor,
          parts: {
            supplier: 1,
            amount: amountClose ? 1 : 0,
            date: dateClose ? 1 : 0,
            reference: byRef ? 1 : 0,
          },
          score,
          evidence: why,
        },
      });
    }
  });

  const resolved = reconcile(claims);
  const byLineKey = new Map(resolved.assigned.map((a) => [a.transactionId, a]));
  const invoiceById = new Map(ourInvoices.map((i) => [i.invoiceId, i]));
  const claimedIds = new Set(resolved.assigned.flatMap((a) => a.candidate.invoiceIds));

  const lines: LineMatch[] = [];
  let debitIndex = -1;
  /** يكشف تكرار السطر داخل كشف المورّد نفسه. */
  const seenLines = new Set<string>();

  for (const line of statementLines) {
    if (line.debitMinor <= 0) {
      /*
        الدائن ليس دائماً سداداً: قد يكون إشعاراً دائناً — مرتجَعاً أو
        خصماً — وهو يغيّر ما علينا لا ما دفعناه. ويُفصَل بوصفه.
      */
      const text = `${line.description ?? ""} ${line.ref ?? ""}`;
      const isCredit = /اشعار\s*دائن|إشعار\s*دائن|credit\s*note|مرتجع|خصم/i.test(text);
      lines.push({ line, status: isCredit ? "CREDIT_NOTE" : "PAYMENT" });
      continue;
    }

    debitIndex++;
    const fingerprint = `${line.date.toISOString().slice(0, 10)}|${line.debitMinor}|${normalizeRef(line.ref ?? line.description)}`;
    if (seenLines.has(fingerprint)) {
      lines.push({ line, status: "DUPLICATE_LINE" });
      continue;
    }
    seenLines.add(fingerprint);

    const hit = byLineKey.get(`line-${debitIndex}`);
    if (!hit) {
      lines.push({ line, status: "MISSING_FROM_ARCHIVE" });
      continue;
    }

    const invoice = invoiceById.get(hit.candidate.invoiceIds[0])!;
    const difference = line.debitMinor - invoice.totalMinor;
    const byRef = hit.candidate.parts.reference === 1;
    const dateClose = hit.candidate.parts.date === 1;

    /*
      مرشّحان متقاربان في المرجع تنازعٌ يُعلَن، لا يُحسم بصمت: قد يكون
      المورّد كرّر رقماً أو كرّرنا نحن فاتورة.
    */
    const contested =
      hit.runnerUpScore !== null && hit.candidate.score - hit.runnerUpScore < 0.05;

    const status: LineStatus =
      contested ? "REFERENCE_CONFLICT"
      : Math.abs(difference) > tolerance ? "AMOUNT_MISMATCH"
      : !dateClose ? "DATE_MISMATCH"
      : "MATCHED";

    lines.push({
      line,
      invoice,
      method: byRef ? "REF" : "AMOUNT_DATE",
      differenceMinor: difference,
      score: Math.round(hit.candidate.score * 100),
      why: hit.candidate.evidence,
      status,
    });
  }

  const missingFromArchive = lines.filter((l) => l.status === "MISSING_FROM_ARCHIVE");
  const amountMismatches = lines.filter((l) => l.status === "AMOUNT_MISMATCH");
  const notInStatement = ourInvoices.filter((i) => !claimedIds.has(i.invoiceId));

  const theirBilledMinor = statementLines.reduce((s, l) => s + Math.max(0, l.debitMinor), 0);
  const theirPaidMinor = statementLines.reduce((s, l) => s + Math.max(0, l.creditMinor), 0);
  const ourBilledMinor = ourInvoices.reduce((s, i) => s + i.totalMinor, 0);

  let balanceArithmeticOk: boolean | null = null;
  let computedClosingMinor: number | null = null;
  if (options.closingBalanceMinor !== undefined) {
    computedClosingMinor =
      (options.openingBalanceMinor ?? 0) + theirBilledMinor - theirPaidMinor;
    balanceArithmeticOk =
      Math.abs(computedClosingMinor - options.closingBalanceMinor) <= tolerance;
  }

  const findings: Finding[] = [];

  if (missingFromArchive.length > 0) {
    const total = missingFromArchive.reduce((s, l) => s + l.line.debitMinor, 0);
    findings.push({
      code: ISSUE.INVOICE_IN_STATEMENT_NOT_ARCHIVED,
      severity: "WARN",
      message: `${missingFromArchive.length} فاتورة في كشف المورّد بقيمة ${(total / 100).toFixed(2)} ريال ولا ملف لها عندنا — اطلبها منه`,
    });
  }

  if (amountMismatches.length > 0) {
    findings.push({
      code: ISSUE.STATEMENT_AMOUNT_MISMATCH,
      severity: "WARN",
      message: `${amountMismatches.length} فاتورة يخالف مبلغها في الكشف مبلغها عندنا`,
    });
  }

  if (notInStatement.length > 0) {
    findings.push({
      code: ISSUE.INVOICE_NOT_IN_STATEMENT,
      ...ISSUE_TEXT.INVOICE_NOT_IN_STATEMENT,
      message: `${notInStatement.length} فاتورة عندنا لم ترد في كشفه — تحقّق أنّها ليست مكرّرة أو لغير هذا المورّد`,
    });
  }

  if (balanceArithmeticOk === false) {
    findings.push({
      code: ISSUE.STATEMENT_AMOUNT_MISMATCH,
      severity: "WARN",
      message: `حساب الكشف نفسه لا يستقيم: افتتاحي وحركات تعطي ${(computedClosingMinor! / 100).toFixed(2)} والختامي المكتوب ${(options.closingBalanceMinor! / 100).toFixed(2)}`,
    });
  }

  return {
    lines,
    missingFromArchive,
    notInStatement,
    amountMismatches,
    matchedCount: lines.filter((l) => l.status === "MATCHED").length,
    theirBilledMinor,
    theirPaidMinor,
    ourBilledMinor,
    billedDifferenceMinor: theirBilledMinor - ourBilledMinor,
    balanceArithmeticOk,
    computedClosingMinor,
    findings,
  };
}

/** مذكّرة فروق جاهزة للإرسال إلى المورّد. */
export function buildDiscrepancyMemo(
  supplierName: string,
  periodLabel: string,
  r: Reconciliation,
): string {
  const riyals = (m: number) => (m / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
  const out: string[] = [
    `السلام عليكم ${supplierName}،`,
    ``,
    `راجعنا كشف حسابكم عن ${periodLabel} وقابلناه بسجلاتنا:`,
    ``,
    `• ما حمّلتموه علينا: ${riyals(r.theirBilledMinor)} ريال`,
    `• ما لدينا من فواتيركم: ${riyals(r.ourBilledMinor)} ريال`,
  ];

  if (r.billedDifferenceMinor !== 0) {
    const more = r.billedDifferenceMinor > 0;
    out.push(
      `• الفرق: ${riyals(Math.abs(r.billedDifferenceMinor))} ريال ${more ? "زيادة عندكم" : "زيادة عندنا"}`,
    );
  }

  if (r.missingFromArchive.length > 0) {
    out.push(``, `فواتير في كشفكم لم تصلنا نسخها، نرجو إرسالها:`);
    for (const l of r.missingFromArchive) {
      out.push(
        `  - ${l.line.date.toISOString().slice(0, 10)} · ${l.line.ref || l.line.description || "بلا مرجع"} · ${riyals(l.line.debitMinor)} ريال`,
      );
    }
  }

  if (r.amountMismatches.length > 0) {
    out.push(``, `فواتير يختلف مبلغها بين كشفكم وبيننا:`);
    for (const l of r.amountMismatches) {
      out.push(
        `  - ${l.invoice!.invoiceNumber} · عندكم ${riyals(l.line.debitMinor)} · عندنا ${riyals(l.invoice!.totalMinor)}`,
      );
    }
  }

  if (r.notInStatement.length > 0) {
    out.push(``, `فواتير لدينا لم ترد في كشفكم:`);
    for (const i of r.notInStatement) {
      out.push(`  - ${i.invoiceNumber} · ${i.invoiceDate.toISOString().slice(0, 10)} · ${riyals(i.totalMinor)} ريال`);
    }
  }

  out.push(``, `نشكر لكم التعاون.`);
  return out.join("\n");
}
