/**
 * هوية الحركة البنكية.
 *
 * البنك لا يعطي معرّفاً ثابتاً لكل حركة، فنبنيه من محتواها. وبدونه كان
 * استيراد الكشف نفسه مرّتين يضاعف حركاته — ووجدنا في القاعدة الحقيقية
 * كشفاً استُورد ثلاث مرّات، فصارت كل حركة ثلاثاً وصار كل تقرير مبنيّ
 * عليها مضاعفاً ثلاث مرّات.
 *
 * وترتيب التكرار داخل المجموعة جزء من الهوية عمداً: الكشف الواحد قد يحمل
 * حركتين متطابقتين تماماً في اليوم — رسمَين، أو فاتورتَي كهرباء لعدّادين —
 * وهما حقيقيتان. فلو أُهمل الترتيب لابتلعت البصمة إحداهما. ومعه: الملف
 * نفسه يعطي البصمات نفسها فلا يتكرّر، والحركتان الحقيقيتان تبقيان اثنتين.
 *
 * ولا تدخل البصمةَ خصائصُ **الملف**، بل خصائص **الحركة** وحدها.
 * كان رقم الحساب جزءاً منها، فاستُورد كشفان لنفس الحساب من مصدرين:
 * أحدهما يحمل رقم الحساب في ترويسته والآخر لا يحمله. فاختلفت البصمتان
 * لحركة واحدة بعينها — نفس التاريخ ونفس المبلغ ونفس الوصف حرفاً بحرف —
 * ودخلت مرّتين. ألفٌ وأربعمئة واثنتان وأربعون حركةً زائدة، ومعها نصف
 * «إيراد» لم يدخل الحساب قطّ.
 *
 * والدرس: ما يتغيّر بتغيّر صيغة التصدير لا يصلح جزءاً من هوية الحركة.
 */
import { createHash } from "node:crypto";
import type { CanonicalTransaction } from "./canonical";

export interface TransactionIdentityInput {
  /** التاريخ بصيغة YYYY-MM-DD */
  valueDate: string;
  amountMinor: number;
  direction: "DEBIT" | "CREDIT";
  description?: string | null;
  /** ترتيب هذه الحركة بين الحركات المطابقة لها في الملف نفسه، من صفر */
  occurrence: number;
}

/**
 * يوحّد الوصف قبل أن يدخل البصمة.
 *
 * صيغتا التصدير تختلفان في الفراغات وحالة الأحرف لنفس الحركة، وهذا
 * اختلاف عرضٍ لا اختلاف معنى.
 */
export function normalizeDescription(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function transactionIdentity(input: TransactionIdentityInput): string {
  /*
    رقم الحساب مقصودٌ خروجه: هو خاصّية ملفٍ لا خاصّية حركة، ويغيب في
    بعض صيغ التصدير فيفرّق بصمةَ حركةٍ واحدة. وتمييزُ الحسابات يقع في
    نطاق القيد (`identityScope`) لا في البصمة.
  */
  const parts = [
    input.valueDate,
    String(input.amountMinor),
    input.direction,
    normalizeDescription(input.description),
    String(input.occurrence),
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

/**
 * المفتاح الطبيعيّ للحركة — تمثيلٌ نصّيّ لما يقيّده الفهرس في القاعدة.
 *
 * وهو **ليس** بصمة: لا يُهشَّم ولا يُختصَر، فلا «نسخة» له تتغيّر
 * بتغيّر الشيفرة فتُبطل ما حُفظ قبلها. والبصمة تبقى للعرض والإحالة،
 * أمّا المنع فعلى هذا.
 */
export function naturalKey(input: {
  valueDate: Date;
  amountMinor: number;
  direction: "DEBIT" | "CREDIT";
  description?: string | null;
}): string {
  return [
    input.valueDate.toISOString().slice(0, 10),
    String(input.amountMinor),
    input.direction,
    normalizeDescription(input.description),
  ].join("|");
}

export interface RowForIdentity {
  valueDate: Date;
  amountMinor: number;
  direction: "DEBIT" | "CREDIT";
  description?: string | null;
}

/**
 * يعطي كل صفّ هويته، محتسباً ترتيب تكراره داخل الملف.
 * الترتيب يُحسب على الصفوف كما وردت، فيثبت ما دام الملف نفسه.
 */
export function assignIdentities<T extends RowForIdentity>(
  rows: readonly T[],
): (T & { externalId: string; occurrence: number })[] {
  const seen = new Map<string, number>();

  return rows.map((row) => {
    const valueDate = row.valueDate.toISOString().slice(0, 10);
    /*
      التطبيع نفسه في العدّ وفي البصمة.

      كان العدّ يستعمل الوصف خاماً والبصمة تستعمله موحَّداً. فحركتان
      لا يفرّقهما إلّا فراغٌ مزدوج — وهذا اختلاف تصديرٍ لا اختلاف
      حركة — تأخذان الترتيب صفراً كلتاهما، ثمّ يوحّدهما التطبيع فتخرج
      لهما بصمةٌ واحدة، فتُبتلَع إحداهما بوصفها «مكرّرة». وهي حركة
      حقيقية بمال حقيقي، تختفي بلا أثر ولا شكوى.

      والقاعدة: تمثيلٌ واحد للهوية، يُعدّ به ويُبصَم به.
    */
    const key = [
      valueDate,
      row.amountMinor,
      row.direction,
      normalizeDescription(row.description),
    ].join("|");
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);

    return {
      ...row,
      occurrence,
      externalId: transactionIdentity({
        valueDate,
        amountMinor: row.amountMinor,
        direction: row.direction,
        description: row.description,
        occurrence,
      }),
    };
  });
}

/**
 * نطاق الهوية: الحساب الداخليّ.
 *
 * البصمة تصف **الحركة**، ولا تصف أين وقعت. فحوالتان بالمبلغ نفسه في
 * اليوم نفسه بالوصف نفسه، إحداهما من حساب الراجحي والأخرى من حساب
 * الأهلي، لهما البصمة نفسها — وكان القيد الفريد على البصمة وحدها،
 * فتُقبَل الأولى وتُرَدّ الثانية بوصفها «مستوردة مسبقاً». حركةٌ حقيقية
 * تُمحى لأنّ حساباً آخر سبقها.
 *
 * فالنطاق جزء من القيد لا من البصمة: الحساب المجهول يأخذ نطاقاً واحداً
 * ثابتاً كي يبقى منع التكرار عاملاً قبل أن تُعرف الحسابات.
 */
export const UNSCOPED = "~";

export function identityScope(bankAccountId: string | null | undefined): string {
  return bankAccountId ?? UNSCOPED;
}

/** المفتاح الكامل كما يفرضه القيد في القاعدة. */
export function scopedIdentity(
  bankAccountId: string | null | undefined,
  externalId: string,
): string {
  return `${identityScope(bankAccountId)}::${externalId}`;
}

/** بصمة الملف كاملاً — استيراده ثانيةً يُعرف بها قبل قراءة صفوفه. */
export function fileFingerprint(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** يعدّ ما في القاعدة من كل مفتاحٍ طبيعيّ. */
export function countByNaturalKey(
  rows: readonly RowForIdentity[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const k = naturalKey(r);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

/**
 * ما لم يُقيَّد بعد من صفوف الملف.
 *
 * القاعدة في سطر: **الكشف يقول كم مرّة وقعت الحركة، والقاعدة تقول كم
 * مرّة قُيّدت. والفرق وحده يدخل.**
 *
 * فملفٌّ يذكر الحركة مرّتين والقاعدةُ فيها مرّتان ← لا شيء. ورفعُ
 * الملف عشرين مرّة ← لا شيء في كلّ مرّة. وكشفٌ أطول يذكرها ثلاثاً
 * والقاعدةُ فيها اثنتان ← تدخل الثالثة وحدها.
 *
 * وهذا يحلّ ما كان يتناقض: منعُ التكرار، وبقاءُ الحركتين المتطابقتين
 * الحقيقيّتين في اليوم الواحد — وهما في كشف أحمد ثلاث وعشرون مجموعة.
 */
export function unseenRows<T extends RowForIdentity & { occurrence: number }>(
  rows: readonly T[],
  priorCount: ReadonlyMap<string, number>,
): T[] {
  return rows.filter((r) => r.occurrence >= (priorCount.get(naturalKey(r)) ?? 0));
}

/**
 * مراجع العمليّة — كلُّ ما يصلح أن يدلّ على هذه الحوالة بعينها.
 *
 * المفتاح الطبيعيّ يمنع أن يدخل الكشفُ مرّتين، ولا يمنع أن **يذكر
 * الكشفُ الواحد الحوالةَ مرّتين**، ولا أن يُعاد تصديرُها بوصفٍ مختلف.
 * والحوالة تحمل ما لا يحمله الرسم: رقمُ عمليّة لا يتكرّر.
 *
 * **وتُرجَع قائمةً لا نصّاً واحداً.** لأنّ التصدير قد يُسقط بعضها:
 * كشفٌ يكتب «مرجع123456789» ورمزَ الحوالة معاً، وآخر يكتب المرجع
 * وحده. فلو رُبطت في نصٍّ واحد لاختلف النصّان لحوالةٍ واحدة — وهذا
 * بعينه ما يُنتج التكرار. والمقابلة بالتقاطع: مرجعٌ واحد مشترك يكفي.
 *
 * وحركات الشبكة تُستثنى: «REFERENCE : 81140155 MC26 0811» رقمُ طرفيّةٍ
 * وشبكةٍ وتاريخ، لا رقم عمليّة — ويتكرّر بطبيعته.
 */
export function operationRefs(tx: CanonicalTransaction): string[] {
  if (tx.pos) return [];

  const out: string[] = [];
  for (const r of tx.references) {
    if (r.kind === "BANK_REF") out.push(`BANK_REF:${r.value}`);
    /*
      و«رقم السداد» **ليس** مرجع عمليّة: هو رقم المشترك عند الجهة —
      رقمُ عدّاد الكهرباء، ورقمُ الهاتف، والرقمُ الضريبيّ — ويتكرّر في
      فاتورة كلّ شهر. فلو عُدّ هويّةً لابتُلعت فاتورةُ الشهر الثاني
      بوصفها «مقيَّدة من قبل»، ومالٌ خرج فعلاً لا أثر له.

      وظهر ذلك في الفحص: ثلاث حركات سدادٍ حكوميّ تغيّر تصنيفُها بمجرّد
      قلب ترتيب الصفوف — والترتيب لا يغيّر حقيقة. ورقمُ العمليّة عند
      البنك موجودٌ في الوصف نفسه بعد كلمة «مرجع»، وهو المأخوذ.
    */
  }
  /*
    ورمز الحوالة يأتي بلا كلمةٍ تسبقه: «ANCBKNCBK6B82411900579769»
    داخل «حوالات تحت الطلب…». فيُلتقَط بشكله: طويلٌ يخلط حرفاً برقم.
  */
  for (const m of tx.searchText.matchAll(
    /\b(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{12,}\b/gi,
  )) {
    out.push(`TOK:${m[0].toUpperCase()}`);
  }
  return [...new Set(out)];
}

/**
 * المرجع الذي يُخزَّن ويُقيَّد به في القاعدة — واحدٌ ثابت الاختيار.
 *
 * والترتيب ليس اعتباطاً: «مرجع» رقمُ العمليّة عند البنك نفسه، ورمزُ
 * الحوالة بعده لأنّه أكثر سقوطاً من التصديرات المختصرة.
 */
export function operationRef(tx: CanonicalTransaction): string | null {
  const refs = operationRefs(tx);
  return refs.find((r) => r.startsWith("BANK_REF:"))
    ?? refs.find((r) => r.startsWith("TOK:"))
    ?? null;
}
