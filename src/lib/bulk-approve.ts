/**
 * أتُعتمد هذه الفاتورةُ ضمن «اعتمد المحدَّد» بلا أن يفتحها صاحبُها؟
 *
 * الاعتمادُ دفعةً يمرّ بالخادم واحدةً واحدة بالفحص نفسه (التكرار · الحساب · الشهر المقفل ·
 * الضريبة) — هذا لا يتغيّر. لكنّ ما يحتاج عينَ إنسانٍ لا يُعتمد عنه: يُترك ويُسمّى سببُه
 * فيراجعه وحده (أحمد، ٢٣ أكتوبر ٢٠٢٦: «خيار أحدد فواتير وتعتمد كلها دفعة واحدة»، وقبله:
 * «لا يحذف أي فاتورة ولا يؤثر على دقة العملية أو القراءة»).
 *
 * `null`: تُعتمد. ونصٌّ: لماذا تُركت.
 */
import type { ExtractionEvidence } from "./extraction/evidence";

export interface BulkCandidate {
  canArchive: boolean;
  /** موانعُه كلُّها ممّا يُقرّ به، وقد أقرّ صاحبُ العمل في بطاقتها */
  acknowledged: boolean;
  /** أوّلُ مانعٍ بنصّه — لما يُقال */
  firstBlocker: string | null;
  supplierKnown: boolean;
  /** حقولٌ قُرئت بثقةٍ ضعيفة */
  lowConfidenceFields: readonly string[];
  /** صحّح صاحبُ العمل حقولَها بيده — فقد رآها */
  editedByHand: boolean;
  evidence: Pick<ExtractionEvidence, "unresolvedConflicts" | "disagreements" | "reaskChanged"> | null;
  /** يُعاد حكمُها بعد تعديلٍ لم يصل جوابُه */
  reviewing: boolean;
}

export function bulkSkipReason(c: BulkCandidate): string | null {
  if (c.reviewing) return "يعيد النظام فحصها بتصحيحاتك، فاعتمدها بعد أن ينتهي";
  if (!c.canArchive && !c.acknowledged) return c.firstBlocker ? `يمنعها: ${c.firstBlocker}` : "يمنعها ما في «ملاحظات الفحص»";
  if (!c.supplierKnown) return "لم يُعرف المورّد، فاختره في بطاقتها";
  if (!c.editedByHand) {
    if (c.lowConfidenceFields.length > 0) return `قُرئ بثقة ضعيفة: ${c.lowConfidenceFields.join("، ")}. قارنه بالورقة`;
    if (c.evidence?.disagreements.some((d) => d.blocking)) return "رمز الفاتورة (QR) يخالف ما قُرئ";
    if ((c.evidence?.unresolvedConflicts.length ?? 0) > 0) return "في حسابها تعارض لم يُحسم";
    if ((c.evidence?.reaskChanged.length ?? 0) > 0) return "تبدّل مبلغ حين أُعيدت قراءتها";
  }
  return null;
}
