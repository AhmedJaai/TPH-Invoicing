import Link from "next/link";
import { Trash2 } from "lucide-react";
import { Money } from "./money";
import { BarList, Callout, Card, EmptyState, Section } from "./ui";
import { PRODUCT, TIME, countNoun } from "@/lib/arabic";
import { BOARD_REASON_LABEL } from "@/lib/inventory/waste-board";
import { milliToDecimal } from "@/lib/inventory/units";
import { formatDay } from "@/lib/riyadh-time";
import { loadWasteBoard, WASTE_BOARD_WEEKS } from "@/services/waste-board.service";
import { T } from "@/components/i18n/t";

/**
 * هدرُ الأسابيع الثمانية بالكلفة ولأيّ سبب — قراءةٌ لما سُجّل في الجرد، لا منتجُ
 * إدارة هدر. ما لا سعرَ لصنفه يُعَدّ بجانب المجموع ولا يُجمَع صفراً.
 */
/** عددُ المشروبات من المِلّي — بلا كسرٍ إن لم يكن */
function trimUnits(milli: number): string {
  /* بالعدد الصحيح لا بالقسمة العائمة: «3.500» ← «3.5»، و«2.000» ← «2» */
  return milliToDecimal(milli).replace(/\.?0+$/, "");
}

export async function WasteBoardSection() {
  const b = await loadWasteBoard();
  /* المجهولُ من سجلّات اليد وحدها — مكوّناتُ المرتجع تُعَدّ مكوّناتٍ لا «مرّات» */
  const recordsUnknown = b.unknownCount - b.returnedAfterPrep.unknownCount;
  return (
    <Section
      id="waste"
      title="الهدر المسجّل"
      icon={Trash2}
      hint={`آخر ${WASTE_BOARD_WEEKS} أسابيع (منذ ${formatDay(b.since)})، بسعر الوحدة في آخر جرد للصنف. يُسجَّل الهدر في خطوة «ماذا اختلف؟» من الجرد.`}
    >
      {b.recordCount === 0 && b.returnedAfterPrep.lines === 0 ? (
        <EmptyState
          compact
          icon={Trash2}
          title="لم يُسجَّل هدر في هذه الأسابيع."
          hint="عدم التسجيل لا يعني أن الهدر لم يقع، وما لم يُسجَّل يبقى في الجرد «فرقاً غير مفسَّر»."
        />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
          <Card>
            <p className="text-xs font-bold text-muted">تكلفة الهدر المسجّل بحسب السبب</p>
            <p className="mt-2 text-2xl font-semibold tracking-tight"><Money minor={b.knownCostMinor} currency /></p>
            <p className="mt-1 text-[11px] text-muted">
              {b.recordCount === 0
                ? "لم يُسجَّل هدرٌ باليد في الجرد — المجموعُ كلُّه من المرتجع بعد التحضير."
                : <T s="سُجّل فيها هدر {0}{1}" a={[countNoun(b.recordCount, TIME), recordsUnknown > 0 && <span key="1" className="font-bold text-warn"> <T s=" · منها {0} تكلفتها غير معروفة، وهي خارج المجموع" a={[countNoun(recordsUnknown, TIME)]} /></span>]} />}
              {b.returnedAfterPrep.unknownCount > 0 && <span className="font-bold text-warn"> <T s=" · ومن مكوّنات المرتجع {0} بلا سعرٍ معروف، خارج المجموع" a={[countNoun(b.returnedAfterPrep.unknownCount, PRODUCT)]} /></span>}</p>
            {b.returnedAfterPrep.lines > 0 && (
              <p className="mt-1 text-[11px] leading-relaxed text-muted">
                <T s="المشروب الذي حُضّر ثم أُرجع يُحسب مستهلكاً وهدراً معاً (المشروباتُ المرتجعة بعد التحضير: {0}، من أسطر البيع لا من سجلٍّ يدوي). والجاهز الذي يعود إلى الرف لا يُحسب هدراً." a={[<span key="0" className="nums">{trimUnits(b.returnedAfterPrep.unitsMilli)}</span>]} /></p>
            )}
            <div className="mt-4">
              <BarList
                tone="warn"
                items={b.byReason.map((r) => ({
                  key: r.reason,
                  label: BOARD_REASON_LABEL[r.reason],
                  minor: r.costMinor,
                  /* المرتجعُ يُعَدّ بمشروباته كما في الفقرة فوقه — لا بأسطر البيع («79 مرّة» بجانب «109») */
                  sub: r.reason === "RETURNED_AFTER_PREP"
                    ? `المشروبات: ${trimUnits(b.returnedAfterPrep.unitsMilli)}${r.unknownCount > 0 ? ` · مكوّناتٌ بلا تكلفة: ${r.unknownCount}` : ""}`
                    : r.unknownCount > 0 ? `${countNoun(r.count, TIME)} · ${r.unknownCount} بلا تكلفة` : countNoun(r.count, TIME),
                }))}
              />
            </div>
          </Card>
          <Card>
            <p className="text-xs font-bold text-muted">أكثر الأصناف هدراً</p>
            {b.topProducts.length === 0 ? (
              <p className="mt-3 text-xs leading-relaxed text-muted">غير معروف: لا سعر وحدة لأي صنف من الأصناف المهدرة. سيُعرف بعد أول جرد تُربط فيه مشترياتها.</p>
            ) : (
              <div className="mt-3">
                <BarList
                  items={b.topProducts.map((p) => ({
                    key: p.productId,
                    label: p.productName,
                    minor: p.costMinor,
                    sub: p.count === 0 ? "من المرتجع بعد التحضير" : p.returned ? `${countNoun(p.count, TIME)} · ومن المرتجع` : countNoun(p.count, TIME),
                    href: `/inventory/items/${p.productId}`,
                  }))}
                />
              </div>
            )}
            {b.repeatedExpiry.length > 0 && (
              <Callout tone="warn" className="mt-4" title="انتهت صلاحيته أكثر من مرة">
                <T s="{0}. تكرار ذلك يعني أنك تطلب كمية أكبر مما يُباع قبل انتهاء صلاحيته." a={[b.repeatedExpiry.map((x, i) => (
                  <span key={x.productId}>
                    {i > 0 && "، "}
                    <Link href={`/inventory/items/${x.productId}`} className="font-bold hover:underline">{x.productName}</Link> ({countNoun(x.count, TIME)})
                  </span>
                ))]} /></Callout>
            )}
          </Card>
        </div>
      )}
    </Section>
  );
}
