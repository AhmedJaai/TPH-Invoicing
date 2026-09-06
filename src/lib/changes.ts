/**
 * ما الذي تغيّر.
 *
 * كل ما في النظام يخصّ الماضي: فواتير وصلت وحركات مضت. ولا شيء يجيب
 * «ما الجديد منذ آخر مرّة فتحتُ فيها؟» — وهذا هو السبب الذي يجعل
 * صاحب العمل يفتح تطبيقاً كل صباح، أو لا يفتحه.
 *
 * والمقارنة تحتاج أساساً يُقاس عليه. فما لا أساس له لا يُعرض «صفر٪»
 * بل يُقال إنّه جديد — لأنّ النسبة إلى صفر ليست رقماً.
 *
 * دوالّ خالصة: تأخذ وقائع وتُرجع تغيّرات.
 */

export type ChangeDirection = "UP" | "DOWN" | "FLAT" | "NEW";

export interface Change {
  id: string;
  label: string;
  /** ما يُقارَن به — «عن الأسبوع الماضي»، «عن الشهر السابق». */
  baseline: string;
  direction: ChangeDirection;
  /** `null` حين لا أساس يُقاس عليه. */
  pct: number | null;
  currentMinor?: number;
  previousMinor?: number;
  /** هل هذا التغيّر في صالحه؟ ارتفاع المشتريات ليس كارتفاع المبيعات. */
  favourable: boolean | null;
  detail: string;
  href?: string;
}

/** ما دون هذا الحدّ ضجيجٌ لا تغيّر. */
export const NOISE_PCT = 5;

export function direction(current: number, previous: number): ChangeDirection {
  if (previous === 0) return current === 0 ? "FLAT" : "NEW";
  const pct = ((current - previous) / previous) * 100;
  if (Math.abs(pct) < NOISE_PCT) return "FLAT";
  return pct > 0 ? "UP" : "DOWN";
}

export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export interface ChangeFacts {
  /** مشتريات الشهر الجاري والذي قبله، بالهللات. */
  purchasesThisMonth: number;
  purchasesPrevMonth: number;
  thisMonthLabel: string;
  prevMonthLabel: string;
  /**
   * كم يوماً مضى من الشهر الجاري — أو `null` إن كان تامّاً.
   *
   * حين يكون جارياً تُقصّ مشتريات الشهر السابق عند اليوم نفسه، وإلّا
   * قُورن ستّة أيامٍ بشهرٍ كامل فقيل «أنفقتَ أقلّ بثمانيةٍ وتسعين
   * بالمئة» في السادس من كل شهر — إنذارٌ كاذبٌ دوريّ يُفقد الثقة
   * بالصفحة كلّها.
   */
  daysElapsedInMonth: number | null;

  /** مستندات وصلت في آخر سبعة أيام، والسبعة التي قبلها. */
  documentsLast7: number;
  documentsPrev7: number;

  /** الرصيد المستحقّ الآن، وقبل ثلاثين يوماً. */
  outstandingNow: number;
  outstandingThen: number;

  /** أصناف ارتفع سعرها منذ آخر شراء، وأثرها السنويّ المقدَّر. */
  risingItems: number;
  risingAnnualMinor: number;

  /** حركات بنكية جديدة لم تُصنَّف. */
  newUnclassified: number;
}

export function buildChanges(f: ChangeFacts): Change[] {
  const out: Change[] = [];

  /* ── المشتريات ── */
  {
    const dir = direction(f.purchasesThisMonth, f.purchasesPrevMonth);
    const pct = pctChange(f.purchasesThisMonth, f.purchasesPrevMonth);
    const partial = f.daysElapsedInMonth !== null;
    out.push({
      id: "purchases",
      label: "المشتريات",
      /*
        الأساس يقول ما قِيس فعلاً. والشهر الجاري يُقارَن بمثله من
        السابق — أوّل ستّة أيامٍ بأوّل ستّة — لا بشهرٍ تامّ.
      */
      baseline: partial
        ? `عن أوّل ${f.daysElapsedInMonth} يوماً من ${f.prevMonthLabel}`
        : `عن ${f.prevMonthLabel}`,
      direction: dir,
      pct,
      currentMinor: f.purchasesThisMonth,
      previousMinor: f.purchasesPrevMonth,
      // ارتفاع المشتريات ليس سيّئاً بذاته — قد يعني نموّاً. فلا يُحكَم عليه.
      favourable: null,
      detail:
        dir === "NEW" ? `أوّل مشتريات في ${f.thisMonthLabel}`
        : dir === "FLAT" ? "قريبة ممّا كانت"
        : dir === "UP" ? "أنفقتَ أكثر — تحقّق أنّه نموٌّ لا تسرّب"
        : "أنفقتَ أقلّ",
      href: "/purchases/invoices",
    });
  }

  /* ── المستندات الواردة ── */
  if (f.documentsLast7 > 0 || f.documentsPrev7 > 0) {
    const dir = direction(f.documentsLast7, f.documentsPrev7);
    out.push({
      id: "documents",
      label: "مستندات وصلت",
      baseline: "عن الأسبوع السابق",
      direction: dir,
      pct: pctChange(f.documentsLast7, f.documentsPrev7),
      favourable: null,
      detail: `${f.documentsLast7} هذا الأسبوع · ${f.documentsPrev7} الذي قبله`,
      href: "/documents",
    });
  }

  /* ── المستحقّ ── */
  {
    const dir = direction(f.outstandingNow, f.outstandingThen);
    out.push({
      id: "outstanding",
      label: "المستحقّ عليك",
      baseline: "عن قبل ثلاثين يوماً",
      direction: dir,
      pct: pctChange(f.outstandingNow, f.outstandingThen),
      currentMinor: f.outstandingNow,
      previousMinor: f.outstandingThen,
      // ارتفاع ما عليك ليس في صالحك، وانخفاضه في صالحك
      favourable: dir === "FLAT" ? null : dir === "DOWN",
      detail:
        dir === "UP" ? "تراكم أكثر ممّا سدَّدتَ"
        : dir === "DOWN" ? "سدَّدتَ أكثر ممّا تراكم"
        : "لم يتغيّر كثيراً",
      href: "/purchases/invoices?paid=UNPAID",
    });
  }

  /* ── الأسعار ── */
  if (f.risingItems > 0) {
    out.push({
      id: "prices",
      label: "أصناف ارتفع سعرها",
      baseline: "عن آخر شراء",
      direction: "UP",
      pct: null,
      currentMinor: f.risingAnnualMinor,
      favourable: false,
      detail:
        f.risingAnnualMinor > 0
          ? `${f.risingItems} صنفاً · أثرها السنويّ المقدَّر`
          : `${f.risingItems} صنفاً`,
      href: "/analysis",
    });
  }

  /* ── حركات لم تُصنَّف ── */
  if (f.newUnclassified > 0) {
    out.push({
      id: "unclassified",
      label: "حركات بلا تصنيف",
      baseline: "في آخر استيراد",
      direction: "UP",
      pct: null,
      favourable: false,
      detail: `${f.newUnclassified} حركة تُنسَب إلى المورّدين ظلماً حتى تُصنَّف`,
      href: "/bank",
    });
  }

  return out;
}

/**
 * ما يستحقّ أن يُعرَض.
 *
 * التغيّر الذي دون حدّ الضجيج ليس خبراً، وعرضه يُغرِق ما هو خبر. لكنّ
 * السكون نفسه خبرٌ حين يكون كلّ شيء ساكناً — فإن لم يبقَ شيء، قيل ذلك.
 */
export function notable(changes: readonly Change[]): Change[] {
  return changes.filter((c) => c.direction !== "FLAT");
}
