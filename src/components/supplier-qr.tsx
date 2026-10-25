import { Fragment } from "react";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { QrCode } from "lucide-react";
import { db } from "@/db";
import { INVOICE, countNoun } from "@/lib/arabic";
import { checkedCount, isStoredQrStatus, qrCoverage } from "@/lib/extraction/qr-coverage";
import { T } from "@/components/i18n/t";

/**
 * «الفوترة الإلكترونيّة: ١٤ من ١٦ برمز» في ملفّ المورّد (`lib/extraction/qr-coverage.ts`).
 * عدٌّ من أدلّة القراءة المحفوظة، وما لم يُفحص يُقال — ولا يُحكم هنا بما يلزم المورّد.
 */
export async function SupplierQrLine({ supplierId, slug }: { supplierId: string; slug: string }) {
  const rows = (await db.execute<{ status: string | null; phase2: boolean | null }>(sql`
    select c.evidence->'qr'->>'status' as status,
           (c.evidence->'qr'->'facts'->>'phase2')::boolean as phase2
      from documents d
      left join extraction_cache c on c.sha256 = d.sha256
     where d.supplier_id = ${supplierId}
       and d.kind = 'TAX_INVOICE'
       and d.status = 'ARCHIVED'
  `)).rows;
  if (rows.length === 0) return null;
  const c = qrCoverage(rows.map((r) => ({ status: isStoredQrStatus(r.status) ? r.status : null, phase2: r.phase2 === true })));
  const checked = checkedCount(c);
  return (
    <p className="mt-4 flex flex-wrap items-start gap-x-2 gap-y-1 border-t border-line-soft pt-3 text-xs leading-relaxed text-ink-soft">
      <QrCode className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" strokeWidth={2} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="font-bold text-ink">رمز الفاتورة الإلكترونية: </span>
        {checked === 0 ? (
          <><T s="غير معروف: {0} ضريبية قُرئت قبل أن يُحفظ دليل الرمز. أعد قراءة واحدة منها ليُفحص رمزها." a={[countNoun(c.invoices, INVOICE)]} /></>
        ) : (
          <>
            <T s="{0} من {1} فاتورة مفحوصة تحمل رمزاً مقروءاً{2}{3}{4}{5}." a={[<bdi key="0" className="nums font-bold text-ink">{c.withQr}</bdi>, <bdi key="1" className="nums">{checked}</bdi>, c.phase2 > 0 && <Fragment key="2"> <T s=" (منها {0} بتوقيع المرحلة الثانية)" a={[<bdi key="0" className="nums">{c.phase2}</bdi>]} /></Fragment>, c.withoutQr > 0 && <span key="3" className="font-bold text-warn"> <T s=" · {0} بلا رمز" a={[<bdi key="0" className="nums">{c.withoutQr}</bdi>]} /></span>, c.foreignQr > 0 && <Fragment key="4"> <T s=" · {0} برمز ليس رمز الهيئة" a={[<bdi key="0" className="nums">{c.foreignQr}</bdi>]} /></Fragment>, c.unchecked > 0 && <span key="5" className="text-muted"> <T s=" · {0} لم تُفحص" a={[<bdi key="0" className="nums">{c.unchecked}</bdi>]} /></span>]} /></>
        )}{" "}
        <Link href={`/purchases/invoices?supplier=${slug}`} className="font-bold text-accent hover:underline">فواتيره</Link>
      </span>
    </p>
  );
}
