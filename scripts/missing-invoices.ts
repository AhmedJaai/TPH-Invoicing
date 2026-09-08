/**
 * لمن دفعنا بلا فاتورة؟
 *
 *   npm run db:missing-invoices
 *
 * ── لماذا يُسأل هذا ──
 *
 * كشف أحمد أنّ «سرد للمعدات» رفع **عرض السعر** إلى الدرايف ولم يرفع
 * الفاتورة. وسؤالُه بعدها هو الصحيح: **كم فاتورةً أخرى لم تُرفع؟**
 *
 * وعروضُ الأسعار أربعةٌ فقط، فلو وقفنا عندها لظنّنا الأمر صغيراً.
 * والقياس الصادق ليس عدّ العروض بل **مقارنة ما خرج من المال بما عندنا
 * من فواتير**: كلّ ريالٍ دُفع لمورّدٍ ولا فاتورة تقابله ريالٌ لا يُخصَم
 * مدخلُ ضريبته، ولا يُثبَت في مراجعة، ولا يُعرَف على أيّ بضاعةٍ وقع.
 *
 * ── وما لا يقوله هذا التقرير ──
 *
 * الفرقُ الموجب ليس اتّهاماً. قد يكون **دفعةً مقدَّمة** لم تصل بضاعتُها،
 * أو فاتورةً سابقةً لبدء الأرشيف، أو مورّداً لا يُصدر فواتير أصلاً —
 * وذلك مسجَّلٌ عندنا في `issuesInvoices`. فيُعرَض الفرق بدليله ويُترَك
 * الحكم لصاحب العمل.
 *
 * والفرقُ السالب حالٌ صحيحة: فواتيرُ لم تُسدَّد بعد — وهو المستحقّ.
 */
import { db } from "@/db";
import { sql } from "drizzle-orm";

interface Row {
  sup: string;
  slug: string | null;
  issues: boolean | null;
  paid: string;
  billed: string;
  gap: string;
  pn: number;
  inn: number;
}

const riyals = (minor: string | number) =>
  (Number(minor) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });

async function main() {
  /*
    والكشفُ فاتورةٌ أيضاً.

    بعض المورّدين لا يعطون فاتورةً لكلّ توريد، يعطون كشف حسابٍ شهريّاً —
    وهو مكتوبٌ في قرارات هذا النظام. فمقياسٌ يقارن الدفعات بجدول
    "invoices" وحده يُظهر «غاناش» مديناً بتسعةٍ وعشرين ألفاً بلا مستند،
    وكشوفُه في الأرشيف. والإنذار الكاذب يُفقد الثقة بما عداه.
  */
  const rows = (
    await db.execute(sql`
      with pay as (
        select supplier_id, sum(amount_minor)::bigint paid, count(*)::int n
        from payments where status <> 'REVERSED' group by 1
      ),
      inv as (
        select supplier_id, sum(billed)::bigint billed, sum(n)::int n from (
          select supplier_id, sum(total_minor)::bigint billed, count(*)::int n
          from invoices group by 1
          union all
          select supplier_id, sum(coalesce(closing_balance_minor,0))::bigint, count(*)::int
          from statements group by 1
        ) t group by 1
      )
      select coalesce(s.name_ar, s.name_en) sup, s.slug, s.issues_invoices issues,
             coalesce(pay.paid, 0)::bigint paid, coalesce(pay.n, 0) pn,
             coalesce(inv.billed, 0)::bigint billed, coalesce(inv.n, 0) inn,
             (coalesce(pay.paid, 0) - coalesce(inv.billed, 0))::bigint gap
      from suppliers s
      left join pay on pay.supplier_id = s.id
      left join inv on inv.supplier_id = s.id
      where coalesce(pay.paid, 0) > 0 or coalesce(inv.billed, 0) > 0
      order by (coalesce(pay.paid, 0) - coalesce(inv.billed, 0)) desc
    `)
  ).rows as unknown as Row[];

  const missing = rows.filter((r) => Number(r.gap) > 0);
  const owed = rows.filter((r) => Number(r.gap) < 0);

  console.log("═══ دُفع ولا فاتورة تقابله ═══\n");
  console.log(
    "المورّد".padEnd(26) + "دُفع".padStart(13) + "فواتير".padStart(13) +
      "الفرق".padStart(13) + "   دفعات/فواتير",
  );

  let total = 0;
  for (const r of missing) {
    total += Number(r.gap);
    const flag = r.issues === false ? "  ← لا يُصدر فواتير" : "";
    console.log(
      String(r.sup).slice(0, 24).padEnd(26) +
        riyals(r.paid).padStart(13) +
        riyals(r.billed).padStart(13) +
        riyals(r.gap).padStart(13) +
        `   ${r.pn}/${r.inn}${flag}`,
    );
  }

  console.log(`\nمجموع ما لا فاتورة له: ${riyals(total)} ريالاً · ${missing.length} مورّداً`);

  console.log("\n═══ فواتير لم تُسدَّد بعد — حالٌ صحيحة ═══\n");
  for (const r of owed) {
    console.log(
      String(r.sup).slice(0, 24).padEnd(26) + riyals(-Number(r.gap)).padStart(13) + " مستحقّ",
    );
  }

  /*
    وعروضُ الأسعار تُعرَض على حدة.

    عرضُ السعر ليس فاتورة، ووجودُه في مجلّد شهرٍ بلا فاتورةٍ تقابله
    علامةٌ على أنّ المورّد رفع العرض ونسي الفاتورة — وهي الحالة التي
    كشفها أحمد في «سرد للمعدات».
  */
  const quotes = (
    await db.execute(sql`
      select d.file_name, d.kind::text kind, d.period_month,
             coalesce(s.name_ar, s.name_en, '(بلا مورّد)') sup,
             (select count(*)::int from invoices i
                where i.supplier_id = d.supplier_id
                  and i.period_month = d.period_month) same_month
      from documents d
      left join suppliers s on s.id = d.supplier_id
      where d.kind::text in ('QUOTATION','PROFORMA') and d.status::text <> 'REJECTED'
      order by d.period_month desc
    `)
  ).rows as unknown as { file_name: string; kind: string; period_month: string; sup: string; same_month: number }[];

  console.log("\n═══ عروض أسعار ومبدئيّات ═══\n");
  for (const q of quotes) {
    const mark = q.same_month === 0 ? "⚠ لا فاتورة لهذا المورّد في الشهر" : `${q.same_month} فاتورة في الشهر`;
    console.log(
      `${q.kind.padEnd(10)} ${String(q.period_month ?? "—").padEnd(9)} ` +
        `${String(q.sup).slice(0, 24).padEnd(26)} ${mark}`,
    );
  }
}

main().then(() => process.exit(0));
