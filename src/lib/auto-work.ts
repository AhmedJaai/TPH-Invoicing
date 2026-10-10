/**
 * ما فعله النظامُ وحده — يُقال لصاحبه بما وقع وبأثره في أرقامه.
 *
 * الاستدراكُ يقيّد فواتيرَ من قراءاتٍ محفوظة ويعتمد ما اجتمعت فيه الشروط، ثمّ
 * تتحدّث الصفحة. فكان «عليك للمورّدين» وعدّادُ الطابور يتبدّلان تحت العين بلا
 * خبر (قاعدةُ ٧ أكتوبر ٢٠٢٦: ما تغيّر يُقال، وسببُه، ومبلغُه، وضابطُه). فالردُّ
 * يحمل ما وقع فعلاً، وهذه الدالّةُ تصوغه — خالصةً، يُختبَر حسابُها.
 *
 * **والمبلغُ المجهول ليس صفراً:** فاتورةٌ قُيِّدت ولم يُعرف إجماليُّها تُعَدّ
 * «وأخرى لم يُعرف مبلغُها» ولا تُجمَع.
 */
import { DOCUMENT, FILE, INVOICE, countNoun } from "./arabic";
import { formatRiyalsDisplay } from "./money";

export interface AutoWorkItem {
  documentId: string;
  fileName: string;
  supplierName: string | null;
  /** `recorded`: قُيِّدت فاتورتُه فزاد ما عليك. `approved`: اعتُمد مستندٌ مقيَّدٌ من قبل. */
  what: "recorded" | "approved";
  /** إجماليُّ الفاتورة بالهللات — `null` «لم يُعرف». */
  totalMinor: number | null;
}

export interface AutoWorkCounts {
  /** مستنداتٌ جديدة وصلت من الدرايف. */
  arrived?: number;
  renamed?: number;
  reread?: number;
  /** حركاتُ بنكٍ رُبطت بسدادٍ قُيِّد بيد، ودفعاتٌ مكرَّرة دُمجت. */
  linked?: number;
}

export interface AutoWorkSummary {
  title: string;
  body: string;
  /** ما زاد على «عليك للمورّدين» بالقيد الآليّ — المعلومُ منه. */
  owedAddedMinor: number;
  /** فواتيرُ قُيِّدت ولم يُعرف مبلغُها. */
  owedUnknown: number;
  /** أيمسّ هذا رقماً ماليّاً يراه صاحبُه؟ */
  touchesMoney: boolean;
}

const MAX_NAMES = 3;

/** يقرأ ما في الردّ بفحصٍ لا بتحويل نوع — وما لا يُفهَم يُسقَط. */
export function readAutoWork(v: unknown): AutoWorkItem[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x): AutoWorkItem[] => {
    if (typeof x !== "object" || x === null) return [];
    if (!("documentId" in x) || typeof x.documentId !== "string") return [];
    if (!("what" in x) || (x.what !== "recorded" && x.what !== "approved")) return [];
    const total = "totalMinor" in x && typeof x.totalMinor === "number" && Number.isSafeInteger(x.totalMinor) ? x.totalMinor : null;
    return [{
      documentId: x.documentId,
      fileName: "fileName" in x && typeof x.fileName === "string" ? x.fileName : "",
      supplierName: "supplierName" in x && typeof x.supplierName === "string" ? x.supplierName : null,
      what: x.what,
      totalMinor: total,
    }];
  });
}

/** `null` حين لم يقع شيءٌ يُقال. */
export function summarizeAutoWork(items: readonly AutoWorkItem[], counts: AutoWorkCounts = {}): AutoWorkSummary | null {
  const recorded = items.filter((i) => i.what === "recorded");
  const approved = items.filter((i) => i.what === "approved");
  const arrived = Math.max(0, counts.arrived ?? 0);
  const renamed = Math.max(0, counts.renamed ?? 0);
  const reread = Math.max(0, counts.reread ?? 0);
  const linked = Math.max(0, counts.linked ?? 0);
  if (recorded.length + approved.length + arrived + renamed + reread + linked === 0) return null;

  const owedAddedMinor = recorded.reduce((s, i) => s + (i.totalMinor ?? 0), 0);
  const owedUnknown = recorded.filter((i) => i.totalMinor === null).length;

  const head = [
    recorded.length > 0 ? `قيّد ${countNoun(recorded.length, INVOICE)}` : null,
    approved.length > 0 ? `اعتمد ${countNoun(approved.length, DOCUMENT)}` : null,
    recorded.length + approved.length === 0 && arrived > 0 ? `قرأ ${countNoun(arrived, DOCUMENT)} جديداً من الدرايف` : null,
  ].filter(Boolean);
  const title = head.length > 0 ? `النظام ${head.join(" و")} وحده` : "عملٌ آليّ وقع في الخلفيّة";

  const names = [...new Set(recorded.concat(approved).map((i) => i.supplierName).filter((n): n is string => !!n))];
  const lines = [
    recorded.length > 0
      ? (owedAddedMinor > 0
          ? `زاد ما عليك للمورّدين ${formatRiyalsDisplay(owedAddedMinor)}`
          : "قُيِّدت فواتير")
        + (owedUnknown > 0 ? `${owedAddedMinor > 0 ? " — و" : " — "}${countNoun(owedUnknown, INVOICE)} لم يُعرف مبلغُها` : "")
        + " (قراءتُها كاملةٌ ولا نسخةَ لها)"
      : null,
    approved.length > 0 ? "المعتمَدُ اجتمعت فيه شروطُ الأرشفة الآليّة فخرج من طابور المراجعة" : null,
    names.length > 0 ? `${names.slice(0, MAX_NAMES).join("، ")}${names.length > MAX_NAMES ? ` و${names.length - MAX_NAMES} غيرهم` : ""}` : null,
    recorded.length + approved.length > 0 && arrived > 0 ? `ووصل ${countNoun(arrived, DOCUMENT)} جديداً من الدرايف` : null,
    linked > 0 ? `ورُبط ${linked} في البنك بسدادٍ قيّدتَه بيدك` : null,
    renamed > 0 ? `وسُمّي ${countNoun(renamed, FILE)} في الدرايف` : null,
    reread > 0 ? `وأُعيدت قراءةُ ${countNoun(reread, INVOICE)}` : null,
  ].filter(Boolean);

  return {
    title,
    body: lines.join(" · "),
    owedAddedMinor,
    owedUnknown,
    touchesMoney: recorded.length > 0 || linked > 0,
  };
}
