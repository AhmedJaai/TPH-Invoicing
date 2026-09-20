import { sql, type SQL } from "drizzle-orm";
import { suppliers } from "@/db/schema";

/**
 * «ما يُطلَب من هذا المورّد» — قاعدةٌ واحدة، بصيغتين.
 *
 * ── لماذا وُلد هذا الملفّ ──
 *
 * كان السؤالُ الواحد «كم مورّداً يحتاج عقد توريد؟» محسوباً في ثلاثة
 * مواضع، بثلاث نسخٍ من الشرط. وافترقت فعلاً: شاشةُ الرفع كانت تعدّ
 * ‎!issuesInvoices‎ وحده فتقول **٣**، وصفحةُ المورّدين و«يحتاج قرارك»
 * تقرآن الهجرة ٠٣٥ فتقولان **٢**.
 *
 * والعددُ الثالث لسؤالٍ مجابٍ في موضعين ليس معلومةً زائدة — هو **نقضُ
 * الاثنين**: من قرأ الثلاثة لا يعرف أيَّها يصدّق، فيفقد الثقة بها كلّها.
 *
 * فصار الشرطُ هنا وحده: نسخةٌ تُقرأ في TypeScript وأخرى تُحقَن في SQL،
 * ويحرس تطابقَهما ‎supplier-policy-rules.test.ts‎.
 *
 * ── والقاعدة نفسها ──
 *
 * «لم يصل منه مستند» لا تعني «ليس له مستند». فأربعةُ أحوالٍ لا حالان:
 *
 *   • يصدر فواتير ضريبية        → لا يُطلَب عقد، تُطلَب فاتورتُه.
 *   • لا يصدر، وعقدُه عندنا      → استوفى.
 *   • لا يصدر، ولا يُطلَب منه عقد → قرارُ صاحب العمل، وقد أُعلن.
 *   • فواتيرُه ورقيّة            → الفاتورةُ موجودةٌ حقّاً، ومطلبُها
 *                                 رفعُ الورقة لا عقدُ توريد.
 *
 * ولا يُطالَب بالعقد إلّا من سقطت عنه هذه الأربعة. (الهجرة ٠٣٥)
 */

export interface DocumentPolicy {
  issuesInvoices: boolean;
  contractOnFile: boolean;
  contractRequired: boolean;
  paperInvoices: boolean;
}

/** أيلزمه عقدُ توريد؟ */
export function needsContract(s: DocumentPolicy): boolean {
  return !s.issuesInvoices && !s.contractOnFile && s.contractRequired && !s.paperInvoices;
}

/** أمطلبُه رفعُ ورقةٍ لا عقد؟ */
export function needsPaperUpload(s: DocumentPolicy): boolean {
  return s.paperInvoices;
}

/** الشرط نفسه داخل استعلام — يُحقَن ولا يُعاد كتابته. */
export function needsContractSql(): SQL {
  return sql`not ${suppliers.issuesInvoices}
    and not ${suppliers.contractOnFile}
    and ${suppliers.contractRequired}
    and not ${suppliers.paperInvoices}`;
}
