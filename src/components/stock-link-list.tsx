"use client";

import { useState } from "react";
import { Scale } from "lucide-react";
import { LinkRow } from "./inventory-purchase-links";
import { PostAction } from "./post-action";
import { SignalControls } from "./signal-controls";
import { Badge } from "./ui";
import { Money } from "./money";
import type { StockItemOption } from "@/services/inventory-purchase-link.service";
import type { StockLinkRow } from "@/services/stock-link.service";

/**
 * بنودُ الفواتير صفّاً صفّاً مرتَّبةً بقيمتها — بجانب كلٍّ دليلُه وفعلُه.
 * نموذجُ الربط هو نموذجُ الجرد نفسُه (`LinkRow`): يُقترَح فيه الصنفُ والعبوة، ولا يُكتب إلّا بضغطة.
 */
export function StockLinkList({ rows, options, canEdit, notStockKeys }: {
  rows: readonly StockLinkRow[];
  options: StockItemOption[];
  canEdit: boolean;
  notStockKeys: Readonly<Record<string, string>>;
}) {
  const [saved, setSaved] = useState<string | null>(null);
  return (
    <>
      {saved && <p role="status" className="mb-2 text-xs font-medium text-ok">{saved}</p>}
      <ul className="divide-y divide-line rounded-2xl border border-line bg-raised px-4 shadow-raised">
        {rows.map((r) => (
          <li key={r.supplierProductId} className="py-3.5">
            <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px]">
              <span className="font-bold text-ink"><Money minor={r.valueMinor} /></span>
              <span className="text-muted">اشتري منه كلّ الوقت</span>
              {r.evidence && (
                <Badge tone="accent">
                  <Scale className="h-3 w-3" strokeWidth={2} aria-hidden />
                  فودكس: «{r.evidence.productName}» في {r.evidence.matches} {r.evidence.matches === 1 ? "سطر" : "سطراً"} بالمبلغ نفسه
                </Badge>
              )}
              {r.notStock && <Badge tone="muted">ليس مخزوناً</Badge>}
            </div>
            <LinkRow row={r} options={options} canEdit={canEdit && !r.notStock} onSaved={setSaved} />
            {canEdit && r.status !== "LINKED" && (
              <div className="mt-2 flex flex-wrap items-center gap-1">
                <SignalControls signalKey={notStockKeys[r.supplierProductId]} silenced={r.notStock} dismissLabel="ليس مخزوناً — أخرجه" snoozeDays={30} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

/** «أقِرّ الجاهز»: ما اتّفق عليه دليلُ فودكس صنفاً وعبوةً بشاهدَين فأكثر. الخادمُ يعيد الاشتقاق. */
export function ApproveReady({ ids, count }: { ids: readonly string[]; count: number }) {
  return (
    <PostAction url="/api/finance/stock-links" body={{ ids }} variant="primary" size="md" done="ربطت البنود">
      أقرّ الـ{count} الجاهزة
    </PostAction>
  );
}
