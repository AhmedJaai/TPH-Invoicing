/**
 * حدّ الطلبات.
 *
 * واجهة التحليل تستهلك حصّة نموذج يومية، واستيراد البنك يقرأ ملفاً كبيراً
 * في الطلب الواحد. وحلقةٌ واحدة — بخطأ برمجي أو بجلسة مسروقة — تستنفد
 * حصّة اليوم فيقف عمل صاحب المقهى.
 *
 * النافذة ثابتة لا منزلقة: أبسط، وكافية هنا. والعدّ في القاعدة لا في ذاكرة
 * العملية، لأنّ البيئة السحابية تُشغّل نسخاً متعدّدة فيصير الحدّ أضعافه.
 */

export interface RateLimitRule {
  /** عدد الطلبات المسموح بها في النافذة */
  limit: number;
  /** طول النافذة بالثواني */
  windowSeconds: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  /** ثوانٍ حتى تتجدّد النافذة */
  retryAfterSeconds: number;
  limit: number;
}

/** بداية النافذة التي يقع فيها هذا الوقت. */
export function windowStart(at: Date, windowSeconds: number): Date {
  const ms = windowSeconds * 1000;
  return new Date(Math.floor(at.getTime() / ms) * ms);
}

/**
 * القرار بحسب العدّ الحالي.
 * دالة خالصة: القراءة والكتابة مسؤولية المستدعي.
 */
export function decide(
  countInWindow: number,
  rule: RateLimitRule,
  at: Date,
): RateLimitDecision {
  const start = windowStart(at, rule.windowSeconds);
  const elapsed = (at.getTime() - start.getTime()) / 1000;
  const retryAfterSeconds = Math.max(1, Math.ceil(rule.windowSeconds - elapsed));

  return {
    allowed: countInWindow <= rule.limit,
    remaining: Math.max(0, rule.limit - countInWindow),
    retryAfterSeconds,
    limit: rule.limit,
  };
}

/**
 * الحدود لكل واجهة.
 *
 * موضوعة لتمنع الحلقة لا لتضايق الاستعمال البشري: من يرفع عشرين فاتورة
 * متتابعة لا يصطدم بها، ومن يرسل ألفاً يصطدم.
 */
export const RULES: Record<string, RateLimitRule> = {
  // تستهلك حصّة النموذج — الأضيق
  analyze: { limit: 40, windowSeconds: 3600 },
  archive: { limit: 60, windowSeconds: 3600 },
  "statement-reconcile": { limit: 20, windowSeconds: 3600 },
  /*
    المزامنة بلا حدّ — بطلبٍ صريح من أحمد.

    كان اثني عشر في الساعة، فلمّا صار الفحص والتسجيل والتسمية فعلاً
    واحداً يُعاد حتى يستقيم، نفد في دقائق وأوقف العمل ثمانياً وأربعين
    دقيقة. **والحدّ الذي يمنع صاحب النظام من إصلاح نظامه يحمي من لا
    شيء.** رُفع إلى أربعين فلم يكفِ، فرُفع الحدّ كلّه.

    وما يحميه ليس هذا العدّاد: الواجهة محروسة بـ`document:upload`،
    والمزامنة **لا تكتب في الدرايف إلّا التسمية**، ولا تعيد قراءة ما
    قُرئ. فالكلفة تتناسب مع الجديد وحده، والجديدُ محدودٌ بطبعه.

    ويبقى العدّاد قائماً على ما سواها.
  */
  "drive-sync": { limit: Number.MAX_SAFE_INTEGER, windowSeconds: 3600 },
  /* قراءةُ المحتوى تكلّف نداءات نموذج — المشي بلا حدّ، والقراءة بحدّ */
  "drive-sync-content": { limit: 120, windowSeconds: 3600 },
  "bank-import": { limit: 12, windowSeconds: 3600 },
  /* الجرسُ يسأل كلَّ ثلاث دقائق ومع كلّ فتح — قراءةٌ رخيصة بلا نموذج */
  /* وكلُّ تحميلٍ كاملٍ لصفحة يسأله مرّة — والزاحفُ يحمّل مئاتٍ في الساعة */
  notifications: { limit: 3000, windowSeconds: 3600 },
  /*
    كان عشرة في الساعة، وزرُّه في كلّ صفّ من قائمة الفواتير: فالحادية
    عشرة تُردّ وأحمد يرتّب دفاتره القديمة. والوسم الجماعيّ الذي كان
    الحدّ يحرسه أُزيل.
  */
  "mark-paid": { limit: 200, windowSeconds: 3600 },
  /* دفعةٌ بلا مورّد تُحسَم واحدةً واحدة — وقلّما تكون أكثر من عشر */
  "payment-orphan": { limit: 60, windowSeconds: 3600 },
  /* «راجِع الحسابات» — معاينةٌ ثمّ تنفيذ، ولا نموذجَ فيه */
  "account-review": { limit: 60, windowSeconds: 3600 },
  /* ربطُ بنود الفواتير بأصناف الجرد — صنفٌ صنفٌ في جلسة */
  "inventory-purchase-link": { limit: 400, windowSeconds: 3600 },
  /* الإشعارُ الدائن — إدخالٌ بيد، فاتورةً فاتورة */
  "credit-note": { limit: 120, windowSeconds: 3600 },
  /* دمجُ صيغة صنفٍ بأصله — صنفاً صنفاً من صفحة المورّد */
  "supplier-item-merge": { limit: 200, windowSeconds: 3600 },
  /* قيدُ الناقصة من كشف المورّد — كشفاً كشفاً */
  "statement-invoices": { limit: 60, windowSeconds: 3600 },
  /* تُستدعى مع كلّ تعديلٍ في بطاقة الرفع — بلا نموذج */
  "analyze-review": { limit: 600, windowSeconds: 3600 },
  "invoice-replace": { limit: 60, windowSeconds: 3600 },
  /* كلُّ نداءٍ قراءةُ نموذجٍ مدفوعة */
  "document-reread": { limit: 30, windowSeconds: 3600 },
  /* قرارُ صفٍّ ملتبس في الكشف */
  "bank-held": { limit: 200, windowSeconds: 3600 },
  "bank-bounce": { limit: 100, windowSeconds: 3600 },
  "match-undo": { limit: 60, windowSeconds: 3600 },
  counterparty: { limit: 300, windowSeconds: 3600 },
  "match-confirm": { limit: 200, windowSeconds: 3600 },
  "month-close": { limit: 30, windowSeconds: 3600 },
  "bank-rule": { limit: 200, windowSeconds: 3600 },
  supplier: { limit: 60, windowSeconds: 3600 },
  // البحث يُستدعى مع الكتابة، فحدّه مرتفع
  search: { limit: 600, windowSeconds: 3600 },
  // دِلاء منفصلة: كانت المصروفات والأصناف تستهلك حدّ المورّدين
  product: { limit: 200, windowSeconds: 3600 },
  expense: { limit: 60, windowSeconds: 3600 },
  "expense-actual": { limit: 30, windowSeconds: 3600 },
  /*
    تحليلُ الذكاء يستهلك رصيد المزوّد — نداءٌ لكلّ مورّد. والحدّ يتّسع
    لتحليل كلّ المورّدين مرّتين في الساعة، ولا يتّسع لحلقةٍ عالقة.
  */
  "ai-analysis": { limit: 80, windowSeconds: 3600 },
  "ai-findings": { limit: 300, windowSeconds: 3600 },
  /*
    دِلاءٌ صريحة لما كان يقع في الافتراضيّ: الإقرار الجماعيّ كان يشارك
    لا دلوَ «أكّد» ولا دلوَه، والتسمية والتصدير بلا حدٍّ مسمّى.
  */
  "match-confirm-bulk": { limit: 100, windowSeconds: 3600 },
  /* قراءةُ مرشّحي حركة — تُفتح صفّاً صفّاً في طابور المراجعة */
  "match-candidates": { limit: 300, windowSeconds: 3600 },
  "drive-rename": { limit: 60, windowSeconds: 3600 },
  "payment-run": { limit: 60, windowSeconds: 3600 },
  "ops-db-identity": { limit: 30, windowSeconds: 3600 },
  "document-status": { limit: 120, windowSeconds: 3600 },
  "alert-resolve": { limit: 120, windowSeconds: 3600 },
  /* إدارةُ المستخدمين — أفعالٌ قليلة للمالك وحده */
  users: { limit: 60, windowSeconds: 3600 },
};

/**
 * قراءاتٌ رخيصة تُعدّ في ذاكرة الدالّة لا في القاعدة.
 *
 * الجرسُ يسأل مع كلّ صفحة، والبحثُ مع كلّ حرف — وكان كلُّ سؤالٍ منهما يكتب صفّاً
 * في Neon قبل أن يقرأ (كلفةُ نقلٍ وحساب؛ وقد نفد حدُّ النقل في ٢٧ سبتمبر). والعدُّ
 * في الذاكرة لكلّ نسخةٍ من الدالّة: الحدُّ يصير تقريبيّاً (أضعافَه إن تعدّدت النسخ)،
 * وهو كافٍ لما لا نموذجَ فيه ولا كتابة — يوقف الحلقةَ العالقة ولا يحرس مالاً.
 * وكلُّ ما سواهما يبقى في القاعدة.
 */
export const MEMORY_COUNTED_ROUTES: ReadonlySet<string> = new Set(["notifications", "search"]);

/** بلا حدّ: لا يُعدّ أصلاً — عدُّ ما لا يُرفَض كتابةٌ بلا نفع. */
export function isUnlimited(rule: RateLimitRule): boolean {
  return rule.limit >= Number.MAX_SAFE_INTEGER;
}

/**
 * عدّادُ نوافذ في الذاكرة — وذاكرةُ «مَن رُدّ في هذه النافذة».
 *
 * خالصٌ من الوقت: الساعةُ تُعطى. والحجمُ محدود: ما انقضت نافذتُه يُكنَس حين يكبر.
 */
export class MemoryWindowCounter {
  private readonly counts = new Map<string, { windowMs: number; count: number }>();
  constructor(private readonly maxKeys = 5_000) {}

  /** يزيد العدّ ويُعيده. */
  hit(key: string, rule: RateLimitRule, at: Date): number {
    const windowMs = windowStart(at, rule.windowSeconds).getTime();
    const entry = this.counts.get(key);
    if (entry && entry.windowMs === windowMs) {
      entry.count += 1;
      return entry.count;
    }
    if (this.counts.size >= this.maxKeys) this.prune(at.getTime() - rule.windowSeconds * 1000);
    this.counts.set(key, { windowMs, count: 1 });
    return 1;
  }

  /** العدُّ المحفوظ لهذه النافذة، أو صفرٌ إن لم يُحفظ شيء. */
  peek(key: string, rule: RateLimitRule, at: Date): number {
    const entry = this.counts.get(key);
    return entry && entry.windowMs === windowStart(at, rule.windowSeconds).getTime() ? entry.count : 0;
  }

  /** يحفظ عدّاً جاء من القاعدة — ليُردّ التالي بلا كتابة. */
  remember(key: string, rule: RateLimitRule, at: Date, count: number): void {
    if (this.counts.size >= this.maxKeys) this.prune(at.getTime() - rule.windowSeconds * 1000);
    this.counts.set(key, { windowMs: windowStart(at, rule.windowSeconds).getTime(), count });
  }

  private prune(olderThanMs: number): void {
    for (const [k, v] of this.counts) if (v.windowMs < olderThanMs) this.counts.delete(k);
    /* كلُّها حيّة وما زال ممتلئاً: يُفرَّغ — عدٌّ يبدأ من جديد خيرٌ من ذاكرةٍ تكبر بلا حدّ */
    if (this.counts.size >= this.maxKeys) this.counts.clear();
  }

  get size(): number {
    return this.counts.size;
  }
}

export function ruleFor(route: string): RateLimitRule {
  return RULES[route] ?? { limit: 120, windowSeconds: 3600 };
}
