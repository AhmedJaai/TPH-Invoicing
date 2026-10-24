/**
 * قائمة تحقّق إقفال الشهر.
 *
 * الإقفال إعلانٌ بأنّ الشهر تمّ: كل فاتورة وصلت، وكلّ خلل عُولج أو تُجووز
 * عمداً. فلا يكون زرّاً يُضغط، بل قائمةً تُقرأ.
 *
 * والمانع يُفرَّق عن التنبيه: المانع خللٌ في البيانات نفسها لا يجوز إقفال
 * شهر عليه، والتنبيه واقعٌ قد يقرّ به المالك ويمضي — كفاتورة مورّد لا يصدر
 * فواتير ضريبية. الخلط بينهما يجعل القائمة إمّا مستحيلة أو بلا معنى.
 *
 * دالة خالصة: تأخذ حقائق الشهر وتُرجع القائمة.
 */

import type { BalanceStatus } from "@/lib/bank/balance-equation";
import { DAY, DOCUMENT, INVOICE, SUPPLIER, TRANSACTION, WARNING, countNoun } from "./arabic";
import { formatDay, formatMonth } from "./riyadh-time";
import { filingDeadline, periodKey, periodMonths, quarterLabel, quarterOfMonth } from "./vat-return";
import { formatRiyalsDisplay } from "./money";

export type CheckState = "PASS" | "WARN" | "BLOCK";

export interface CheckItem {
  id: string;
  label: string;
  state: CheckState;
  detail: string;
  action?: string;
  /**
   * موضعُ الإصلاح — كما في «يحتاج انتباهك». كانت الموانع نصّاً بلا رابط:
   * «راجعها وأرشفها» تُقرأ ثمّ يُبحث عن مكانها بيد.
   */
  href?: string;
}

export interface MonthFacts {
  month: string;
  invoiceCount: number;
  notTaxValidCount: number;
  /** فواتير لم يُقرأ تفصيلها الضريبي — مجهولة لا غير صالحة */
  unknownTaxCount: number;
  unpaidCount: number;
  unpaidTotalMinor: number;
  unpostedCount: number;
  fixedAssetCount: number;
  openBlockerIssues: number;
  /** نصُّ أحد الموانع — يُقال باسمه لا بعدده وحده */
  openBlockerSample?: string | null;
  documentsNeedingReview: number;
  /** مورّدون لهم فواتير في الشهر */
  suppliersWithInvoices: number;
  /** منهم من وصل كشفه عن الشهر */
  suppliersWithStatement: number;
  /**
   * ومنهم من وصل كشفُه وعليه فرقٌ مفتوح مع دفترنا (فاتورةٌ ناقصة، مبلغٌ
   * يخالف، ختاميٌّ لا يوافق). وصولُ الكشف ليس تطابقَه.
   */
  suppliersWithStatementIssues: number;
  bankImportCoversMonth: boolean;
  /**
   * أيامٌ في الشهر لم يغطّها كشفٌ بنكيّ.
   *
   * الفجوة لا تُرى بلا هذا العدد: حركاتُ أسبوعٍ لم يُستورَد كشفُه تغيب
   * ولا يشكو أحد، لأنّ الغائب لا يظهر في قائمة.
   */
  bankGapDays: number;
  /** حركاتٌ في الشهر لا يُعرف ما هي — لا مطابَقة ولا مصنَّفة. */
  bankUnexplainedCount: number;
  bankUnexplainedMinor: number;
  /**
   * حوالاتٌ صادرة عُرف أنّها لمورّد (أو لها اقتراحٌ ينتظر) ولم تُقيَّد دفعة.
   * ليست «بلا تفسير» — بابُها معروف — فكانت لا يراها الإقفال.
   */
  bankSupplierUnpostedCount: number;
  bankSupplierUnpostedMinor: number;
  /** حال معادلة الكشف: افتتاحي + وارد − صادر = ختامي. */
  bankBalanceStatus: BalanceStatus;
  bankBalanceDifferenceMinor: number | null;
  /** أسُجِّل تقديمُ إقرار ربعِ هذا الشهر؟ — غيابُه «لم يُسأل» فلا يُعرض البند. */
  vatFiled?: boolean;
}

export interface MonthCloseReport {
  month: string;
  items: CheckItem[];
  blockers: CheckItem[];
  warnings: CheckItem[];
  canClose: boolean;
}

const riyals = formatRiyalsDisplay;

/** أين يُصلَح كلُّ بند — مرشَّحاً بالشهر حيث يقبل الترشيح. */
export function fixHref(id: string, month: string): string {
  switch (id) {
    case "has-invoices": return "/upload";
    case "no-blockers": return "/attention?item=open-blockers";
    case "no-pending-review": return "/documents?status=NEEDS_REVIEW";
    case "tax-unknown": return `/purchases/invoices?tax=UNKNOWN&month=${month}`;
    case "tax-valid": return `/purchases/invoices?tax=INVALID&month=${month}`;
    case "paid": return `/purchases/invoices?paid=OPEN&month=${month}`;
    case "statements": return "/statements";
    case "bank": case "bank-coverage": return "/bank";
    case "bank-balance": return "#balances";
    case "bank-unexplained": return "/attention?item=unclassified-bank";
    case "bank-supplier-unposted": return "/bank";
    case "fixed-assets": return `/purchases/invoices?month=${month}&asset=1`;
    default: return "/attention";
  }
}

export function buildMonthClose(facts: MonthFacts): MonthCloseReport {
  const items: CheckItem[] = [];

  /*
   * الشهر بلا فواتير: يمنع الإقفال عمداً.
   * الأرجح أنّ الفواتير لم تُرفع بعد لا أنّه لم يُشترَ شيء، وإقفال شهر فارغ
   * يُغلق الباب على فواتير في الطريق.
   */
  items.push({
    id: "has-invoices",
    label: "فواتير الشهر مرفوعة",
    state: facts.invoiceCount > 0 ? "PASS" : "BLOCK",
    detail:
      facts.invoiceCount > 0
        ? `${countNoun(facts.invoiceCount, INVOICE)} في ${formatMonth(facts.month)}`
        : "لا فاتورة في هذا الشهر",
    action: facts.invoiceCount > 0 ? undefined : "ارفع فواتير الشهر أو زامن الدرايف قبل الإقفال",
  });

  items.push({
    id: "no-blockers",
    label: "لا تنبيهات مانعة مفتوحة",
    state: facts.openBlockerIssues === 0 ? "PASS" : "BLOCK",
    detail:
      facts.openBlockerIssues === 0
        ? "لا شيء يمنع الإقفال"
        : `${countNoun(facts.openBlockerIssues, WARNING)} مانع لم يُعالَج${facts.openBlockerSample ? `، منها: «${facts.openBlockerSample}»` : ""}`,
    action: facts.openBlockerIssues === 0 ? undefined : "افتحها من «أصلح»: كل فاتورة باسمها، فصحّحها أو تجاوزها مع كتابة السبب",
  });

  items.push({
    id: "no-pending-review",
    label: "لا مستندات معلقة للمراجعة",
    state: facts.documentsNeedingReview === 0 ? "PASS" : "BLOCK",
    detail:
      facts.documentsNeedingReview === 0
        ? "كل مستندات الشهر مؤرشفة"
        : `${countNoun(facts.documentsNeedingReview, DOCUMENT)} لم يُقرَّر فيه بعد`,
    action: facts.documentsNeedingReview === 0 ? undefined : "راجعها، ثم أرشفها أو ارفضها",
  });

  /*
   * المجهول بند مستقلّ عن غير الصالح.
   * علاج الأوّل قراءة المستند، وعلاج الثاني مطالبة المورّد ببديل — وخلطهما
   * يُرسل صاحب العمل إلى المورّد ليطالبه بما لم نقرأه بعد.
   */
  if (facts.unknownTaxCount > 0) {
    items.push({
      id: "tax-unknown",
      label: "قُرئ التفصيل الضريبي لكل الفواتير",
      state: "WARN",
      detail: `${countNoun(facts.unknownTaxCount, INVOICE)} لم يُقرأ تفصيلها الضريبي`,
      action: "اقرأ محتواها. حالتها غير معروفة لا غير صالحة، فلا تطالب المورّد قبل ذلك",
    });
  }

  /*
    وما يُفحَص على الفواتير لا يُعلَن ناجحاً على صفرٍ منها: «كل الفواتير
    ضريبية كاملة ✓ — كلّها تصلح لخصم المدخلات» عن شهرٍ بلا فاتورة واحدة
    صدقٌ منطقيّ وكذبٌ عمليّ. والمانعُ «فواتير الشهر مرفوعة» يقول ما ينقص.
  */
  if (facts.invoiceCount > 0) {
    items.push({
      id: "tax-valid",
      label: "كل الفواتير ضريبية مكتملة",
      state: facts.notTaxValidCount === 0 ? "PASS" : "WARN",
      detail:
        facts.notTaxValidCount === 0
          ? "كلها تكفي لخصم ضريبة المشتريات"
          : `${countNoun(facts.notTaxValidCount, INVOICE)} لا تكفي لخصم ضريبة المشتريات`,
      /* أغلبُها ركنٌ لم يُقرأ والورقةُ سليمة — فالعلاجُ عندنا قبل أن يُطالَب المورّد */
      action: facts.notTaxValidCount === 0
        ? undefined
        : "انظر الورقة: إن كان عليها الرقمان الضريبيان فصحّح الفاتورة أو احتسبها من «إقرار الضريبة»، وإن نقصها بيان ضريبي فاطلب من المورّد فاتورة بديلة قبل السداد",
    });

    items.push({
      id: "paid",
      label: "مستحقات الشهر مسدّدة",
      state: facts.unpaidCount === 0 ? "PASS" : "WARN",
      detail:
        facts.unpaidCount === 0
          ? "لا رصيد مستحق"
          : `${countNoun(facts.unpaidCount, INVOICE)} بقيمة ${riyals(facts.unpaidTotalMinor)} ريال`,
      action: facts.unpaidCount === 0 ? undefined : "أضفها إلى دفعة أول الشهر، أو سجّلها مسدّدة",
    });
  }

  /*
    «كل الفواتير مقيَّدة محاسبياً» كان بنداً لا يمرّ أبداً: التصدير
    المحاسبيّ غير مبنيّ عمداً، فيبقى اثنان وخمسون من اثنين وخمسين
    «لم تُقيَّد» مهما فعل صاحب العمل — تنبيهٌ دائم يعلّم تجاهل التنبيهات.
    يعود حين يُبنى مسار القيد.
  */

  if (facts.invoiceCount > 0) {
    const missingStatements = Math.max(0, facts.suppliersWithInvoices - facts.suppliersWithStatement);
    /*
      ثلاثُ حالات لا اثنتان: لم يصل · وصل وفيه فروق · وصل وتطابق. كان البندُ
      يفحص الوصولَ وحده واسمُه «وتطابقت» — فيمرّ أخضرَ وكشفٌ يخالف الدفتر.
      تنبيهٌ لا مانع: الفرقُ قد يكون عند المورّد لا عندنا، ويُقَرّ بسببٍ مكتوب.
    */
    const differing = facts.suppliersWithStatementIssues;
    const parts = [
      missingStatements > 0 ? `${missingStatements} من ${countNoun(facts.suppliersWithInvoices, SUPPLIER)} لم يصل كشف حسابه` : null,
      differing > 0 ? `${countNoun(differing, SUPPLIER)} وصل كشف حسابه وفيه فروق مع سجلاتنا` : null,
    ].filter((x): x is string => x !== null);
    items.push({
      id: "statements",
      label: "كشوف المورّدين وصلت وتطابقت",
      state: parts.length === 0 ? "PASS" : "WARN",
      detail:
        parts.length === 0
          ? `كشوف ${countNoun(facts.suppliersWithInvoices, SUPPLIER)} وصلت، ولا فروق مفتوحة فيها`
          : parts.join(" · "),
      action:
        parts.length === 0 ? undefined
        : missingStatements > 0
          ? "اطلب الكشوف من المورّدين، فهي وحدها تكشف أي فاتورة سُجّلت عليك ولم تصلك"
          : "افتح الكشوف وراجع الفروق: فاتورة ناقصة، أو مبلغ مختلف، أو رصيد ختامي غير مطابق",
    });
  }

  items.push({
    id: "bank",
    /*
      «ويغطّي الشهر» كان ادّعاءً فوق ما يُفحَص هنا: الشرطُ حركةٌ واحدة في
      الشهر. فينجح بجانب «لا أيّام بلا كشف» الساقط، وتناقض القائمةُ نفسها.
      والتغطيةُ يفحصها البندُ الذي يليه.
    */
    label: "كشف البنك مستورد لهذا الشهر",
    /*
      غيابُ الكشف مانع لا تنبيه: أيّام الشهر كلّها فجوة، والفجوة يقين.
      وكان «تنبيهاً» فيُقفَل شهرٌ لم يُقرأ منه ريالٌ بنكيّ.
    */
    state: facts.bankImportCoversMonth ? "PASS" : "BLOCK",
    detail: facts.bankImportCoversMonth ? "في الشهر حركات من كشف البنك" : "لم يُستورد كشف بنك لهذا الشهر، فكل أيامه ناقصة",
    action: facts.bankImportCoversMonth ? undefined : "استورد كشف الحساب من صفحة البنك",
  });

  /*
    الفجوة تمنع الإقفال.

    وكانت تُحسب وتُعرض ولا تمنع — فيُقفَل شهرٌ ينقصه أسبوع كامل من
    الحركات، ويصير الإقفال شهادةً على ما لم يُقرأ. والفرق بين تنبيهٍ
    ومانعٍ هنا هو الفرق بين «قد ينقص» و«ينقص يقيناً»: الفجوة يقين.
  */
  if (facts.bankImportCoversMonth) {
    items.push({
      id: "bank-coverage",
      label: "لا أيام بلا كشف",
      state: facts.bankGapDays === 0 ? "PASS" : "BLOCK",
      detail:
        facts.bankGapDays === 0
          ? "كل أيام الشهر مغطّاة بكشف"
          : `${countNoun(facts.bankGapDays, DAY)} من الشهر بلا كشف، وحركاتها غائبة لا معدومة`,
      action:
        facts.bankGapDays === 0 ? undefined : "استورد الكشف الذي يغطي الأيام الناقصة",
    });

    /*
      المعادلة شرطُ التسوية، لا المطابقة.

      «طوبقت ٣٠١ حركة» لا تقول إنّ الحساب مضبوط: قد تكون المطابقة تامّةً
      على كشفٍ ناقص. والمعادلة وحدها تكشف ما لم يصل أصلاً.
    */
    items.push({
      id: "bank-balance",
      label: "رصيد البنك يتطابق",
      state:
        facts.bankBalanceStatus === "BALANCED" || facts.bankBalanceStatus === "WITHIN_TOLERANCE"
          ? "PASS"
          /* «لم يُفحَص» يمنع كما يمنع «فشل» — والرصيدان يُكتبان أدناه */
          : "BLOCK",
      detail:
        facts.bankBalanceStatus === "UNKNOWN"
          ? "الكشف لا يحمل رصيداً افتتاحياً أو ختامياً، فلا يمكن فحص الرصيد"
          : facts.bankBalanceDifferenceMinor === null || facts.bankBalanceDifferenceMinor === 0
            ? "الرصيد الافتتاحي مع الحركات يساوي الرصيد الختامي"
            : `فرق غير مفسَّر: ${riyals(Math.abs(facts.bankBalanceDifferenceMinor))} ريال`,
      action:
        facts.bankBalanceStatus === "UNEXPLAINED"
          ? "راجع الكشف. الفرق يعني أن هناك حركات لم تُقرأ، لا أن المطابقة خاطئة"
          : facts.bankBalanceStatus === "UNKNOWN"
            ? "اكتب رصيد أول الشهر ورصيد آخره كما في كشف البنك، أو استورد كشفاً فيه عمود الرصيد"
            : undefined,
    });

    if (facts.bankUnexplainedCount > 0) {
      items.push({
        id: "bank-unexplained",
        label: "لا حركة بنكية بلا تفسير",
        state: "WARN",
        detail: `${countNoun(facts.bankUnexplainedCount, TRANSACTION)} بلا تفسير، قيمتها ${riyals(facts.bankUnexplainedMinor)} ريال`,
        action: "افتح قائمة المراجعة وقرّر فيما بقي",
      });
    }
  }

  /*
    حوالاتُ مورّدين بلا قيد.

    «بلا تفسير» = لم تُطابَق **و** بابُها مجهول. فحوالةٌ عُرف مورّدُها ولم
    تُقيَّد دفعةً لا تُعدّ هناك — وهي الحالُ التي أخرجت عشرين حوالةً
    بـ٧٢٬٩٠٤٫٦٨ من الطابور. تنبيهٌ يُقَرّ بسببٍ مكتوب لا مانع: قد تكون دفعةً
    مقدَّمة أو تنتظر فاتورتها، وذلك قرارُ صاحبها.
  */
  if (facts.bankImportCoversMonth && facts.bankSupplierUnpostedCount > 0) {
    items.push({
      id: "bank-supplier-unposted",
      label: "حوالات المورّدين مسجّلة",
      state: "WARN",
      detail: `${countNoun(facts.bankSupplierUnpostedCount, TRANSACTION)} لمورّدين بقيمة ${riyals(facts.bankSupplierUnpostedMinor)} ريال لم تُسجَّل سداداً، فيظهر ما عليك لهم أكثر من الحقيقة`,
      action: "سجّلها على فواتيرها أو على حساب المورّد من قائمة المراجعة",
    });
  }

  if (facts.fixedAssetCount > 0) {
    items.push({
      id: "fixed-assets",
      label: "الأصول الثابتة روجعت",
      state: "WARN",
      detail: `${countNoun(facts.fixedAssetCount, INVOICE)} فوق حد الرسملة`,
      action: "راجعها مع المحاسب، فتسجيلها مصروفاً دفعة واحدة يشوّه ربح الشهر",
    });
  }

  /*
    آخرُ شهرٍ في الربع يحمل إقرارَه: الإقفالُ لا يعرف أنّ بعده موعداً عند الهيئة.
    تنبيهٌ لا مانع — الإقرارُ يُعَدّ بعد إقفال أشهره.
  */
  const quarter = quarterOfMonth(facts.month);
  if (facts.vatFiled !== undefined && periodMonths(quarter)[2] === facts.month) {
    items.push({
      id: "vat-return",
      label: `إقرار ضريبة ${quarterLabel(quarter)} قُدّم`,
      state: facts.vatFiled ? "PASS" : "WARN",
      detail: facts.vatFiled
        ? "سُجّل تقديمه"
        : `هذا آخر شهر في الربع، وآخر موعد لتقديم إقراره وسداده ${formatDay(filingDeadline(quarter))}`,
      action: facts.vatFiled ? undefined : "راجع حسابه وقدّمه في بوابة الهيئة، ثم سجّل «قدّمته»",
      href: facts.vatFiled ? undefined : `/close/vat?period=${periodKey(quarter)}`,
    });
  }

  for (const i of items) {
    if (i.state !== "PASS" && !i.href) i.href = fixHref(i.id, facts.month);
  }

  const blockers = items.filter((i) => i.state === "BLOCK");
  const warnings = items.filter((i) => i.state === "WARN");

  return { month: facts.month, items, blockers, warnings, canClose: blockers.length === 0 };
}

/* ─────────────────── رصيدا الشهر من فترات التسوية ─────────────────── */

export interface BalancePeriod {
  bankAccountId: string;
  /** YYYY-MM-DD */
  periodStart: string;
  periodEnd: string;
  openingMinor: number | null;
  closingMinor: number | null;
  /** أدخله أو راجعه إنسان — يغلب ما قُرئ من الكشف. */
  reviewed: boolean;
}

/**
 * افتتاحيُّ الشهر وختاميُّه من فتراته — لكلّ حسابٍ ثمّ الجمع.
 *
 * كان يُجمَع افتتاحيُّ **كلّ** فترةٍ في الشهر: كشفان نصف شهريّان يعطيان
 * افتتاحيَّ الأوّل + افتتاحيَّ الثاني. والصواب لكلّ حساب: افتتاحيُّ أُولى
 * فتراته وختاميُّ أخراها، ثمّ الجمع عبر الحسابات. وعند التساوي يغلب ما
 * راجعه إنسان. وحسابٌ بلا رصيدٍ معروف يجعل المجموع مجهولاً — لا صفراً.
 */
export function monthBalances(
  periods: readonly BalancePeriod[],
): { openingMinor: number | null; closingMinor: number | null } {
  const byAccount = balancesByAccount(periods);
  if (byAccount.size === 0) return { openingMinor: null, closingMinor: null };

  let opening: number | null = 0;
  let closing: number | null = 0;
  for (const b of byAccount.values()) {
    opening = opening === null || b.openingMinor === null ? null : opening + b.openingMinor;
    closing = closing === null || b.closingMinor === null ? null : closing + b.closingMinor;
  }
  return { openingMinor: opening, closingMinor: closing };
}

/** افتتاحيُّ أُولى فترات كلّ حساب وختاميُّ أخراها — قبل الجمع. وتختمه شهادةُ الإقفال حساباً حساباً. */
export function balancesByAccount(
  periods: readonly BalancePeriod[],
): Map<string, { openingMinor: number | null; closingMinor: number | null }> {
  const byAccount = new Map<string, BalancePeriod[]>();
  for (const p of periods) {
    const list = byAccount.get(p.bankAccountId) ?? [];
    list.push(p);
    byAccount.set(p.bankAccountId, list);
  }
  const out = new Map<string, { openingMinor: number | null; closingMinor: number | null }>();
  for (const [account, list] of byAccount) {
    const first = [...list].sort((a, b) =>
      a.periodStart.localeCompare(b.periodStart) || Number(b.reviewed) - Number(a.reviewed)
      || b.periodEnd.localeCompare(a.periodEnd))[0];
    const last = [...list].sort((a, b) =>
      b.periodEnd.localeCompare(a.periodEnd) || Number(b.reviewed) - Number(a.reviewed)
      || a.periodStart.localeCompare(b.periodStart))[0];
    out.set(account, { openingMinor: first.openingMinor, closingMinor: last.closingMinor });
  }
  return out;
}
