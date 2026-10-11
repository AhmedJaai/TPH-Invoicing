/**
 * تقريرُ المالية على الطرفيّة — قراءةٌ وحدها. يطبع ما تحسبه الخدماتُ نفسُها التي
 * تستدعيها الشاشات، ليُطابَق يدويّاً بمصادره.
 *
 *   npm run finance:report                 كلُّ الأشهر
 *   npm run finance:report -- 2026-09      شهرٌ بأصنافه
 *   npm run finance:report -- pnl          قائمةُ الدخل لكلّ الأشهر
 *   npm run finance:report -- gaps --i-know-this-is-production
 *       يحسب الأصنافَ التي تكرّر فرقُها ويحفظها ليقرأها «يحتاج قرارك» (كتابةُ صفٍّ واحد)
 */
import { formatRiyals } from "@/lib/money";
import { canonicalToQuantity } from "@/lib/inventory/units";
import { loadCumulativeStockFlow, loadMonthStockFlow, type StockFlow } from "@/services/stock-flow.service";
import { loadPnlSeries } from "@/services/profit.service";
import { refreshRecurringGaps } from "@/services/finance-attention.service";
import { assertWriteAllowed } from "./lib/guard-write";

const r = (minor: number | null) => (minor === null ? "غير معروف" : formatRiyals(minor));
const pct = (bp: number | null) => (bp === null ? "—" : `${(bp / 100).toFixed(1)}٪`);

function printFlow(label: string, f: StockFlow, detail: boolean) {
  const t = f.totals;
  console.log(
    `${label}  ${f.window.from}→${f.window.to}  عدّ: ${f.window.openingCountDay ?? "لا"}(${f.openingSource ?? "-"}) → ${f.window.closingCountDay ?? "لا"}(${f.closingSource ?? "-"})\n` +
    `   مشترى(داخل الحساب) ${r(t.purchasedMinor)} من ${r(f.coverage.invoiceLinesMinor)} — تغطية ${pct(f.coverage.bp)}\n` +
    `   مستهلَك نظريّاً ${r(t.consumedMinor)} (منه موظّفون ${r(t.staffMinor)}) · هدر مسجَّل ${r(t.wasteMinor)}\n` +
    `   فرق غير مفسَّر بفواتيرنا: نقص ${r(t.shortageMinor)} · زيادة ${r(t.overageMinor)} · مقيس ${t.measured}/${t.items} — وبمشتريات فودكس: نقص ${r(t.witnessShortageMinor)} في ${t.witnessMeasured}\n` +
    `   مبيعاتٌ خارج الاستهلاك ${r(f.coverage.salesExcludedMinor)} من ${r(f.coverage.salesExcludedMinor + f.coverage.salesIncludedMinor)} · صرفُ فودكس ${f.coverage.witnessDays}/${f.coverage.days} يوماً`,
  );
  const gapOf = (x: StockFlow["items"][number]) => x.unexplainedMinor ?? (x.witnessUnexplainedMinor !== null && x.witnessUnexplainedMinor > 0 ? x.witnessUnexplainedMinor : null);
  const top = f.items.flatMap((x) => { const g = gapOf(x); return g === null || g === 0 ? [] : [{ x, g }]; }).sort((a, b) => Math.abs(b.g) - Math.abs(a.g)).slice(0, 5);
  for (const { x, g } of top) console.log(`     ▸ ${x.name.padEnd(24)} ${r(g).padStart(10)}${x.unexplainedMinor === null ? " (بمشتريات فودكس)" : ""}`);
  const suspects = f.items.filter((x) => x.missing.includes("SUSPECT_ENTRY")).map((x) => x.name);
  if (suspects.length > 0) console.log(`     مشكوكٌ في رقمه: ${suspects.join("، ")}`);
  if (!detail) return;
  const q = (milli: number | null, unit: Parameters<typeof canonicalToQuantity>[1]) => (milli === null ? "؟" : canonicalToQuantity(milli, unit).toFixed(2));
  const rows = [...f.items].sort((a, b) => Math.abs(b.unexplainedMinor ?? b.witnessUnexplainedMinor ?? 0) - Math.abs(a.unexplainedMinor ?? a.witnessUnexplainedMinor ?? 0));
  for (const x of rows) {
    console.log(
      `   ${x.name.padEnd(26)} ${x.baseUnit.padEnd(5)} افتتاحي ${q(x.openingMilli, x.baseUnit)} مشترى ${q(x.purchasedKnownMilli, x.baseUnit)} [فودكس ${q(x.witnessPurchasedMilli, x.baseUnit)}] مستهلك ${q(x.consumed?.milli ?? null, x.baseUnit)} [فودكس ${q(x.witnessConsumedMilli, x.baseUnit)}] ختامي ${q(x.closingMilli, x.baseUnit)} ⇒ فرق ${q(x.unexplainedMilli, x.baseUnit)} = ${r(x.unexplainedMinor)} | بالشاهد ${q(x.witnessUnexplainedMilli, x.baseUnit)} = ${r(x.witnessUnexplainedMinor)} ${x.missing.join(",")}`,
    );
  }
}

async function printPnl() {
  const t0 = Date.now();
  const series = await loadPnlSeries();
  console.log(`\n══ قائمةُ الدخل (${Date.now() - t0}ms) ══`);
  for (const v of [...series].reverse()) {
    const p = v.pnl;
    const c = v.input.cogs;
    console.log(
      `${v.month}${v.closed ? " [مقفل]" : ""}  الإيراد ${r(p.revenueMinor)} (مدفوع ${r(v.revenue?.paidMinor ?? null)} − ضريبة ${r(v.revenue?.vatMinor ?? null)}) · أيّام ${v.revenue?.coveredDays}/${v.revenue?.expectedDays}\n` +
      `   التكلفة [${p.cogsMethod}] ${r(p.cogsMinor)} — مشتريات ${r(c.purchasesMinor)} (${c.purchasesInvoices} فاتورة) · نظريّة ${r(c.theoreticalMinor)} · بالجرد ${r(c.stock?.minor ?? null)}${c.stock ? ` (مخزون ${r(c.stock.openingValueMinor)}→${r(c.stock.closingValueMinor)} · ${c.stock.countedItems} صنفاً · مشكوك: ${c.stock.suspectItems.join("،") || "لا"})` : ` (${c.stockMissing})`} · فودكس ${r(c.foodicsMinor)}\n` +
      `   مجمل ${r(p.grossProfitMinor)} (${pct(p.grossMarginBp)}) · فرق غير مفسَّر ${r(p.unexplainedMinor)} · مصروفات ${r(p.opexMinor)} [${p.opexByCategory.map((o) => `${o.category} ${r(o.amountMinor)}`).join(" · ")}]\n` +
      `   ⇒ ${p.profitLabel}: ${r(p.profitMinor)} (${pct(p.netMarginBp)}) · ينقصه: ${p.gaps.map((g) => g.id).join(",") || "لا شيء"} · مسحوبات ${r(v.input.ownerDrawsMinor)} · مستثنى ${r(v.excludedRows.reduce((s, x) => s + x.amountMinor, 0))}`,
    );
  }
}

async function main() {
  if (process.argv[2] === "pnl") { await printPnl(); process.exit(0); }
  if (process.argv[2] === "gaps") {
    assertWriteAllowed("حفظُ الفروق المتكرّرة");
    const found = await refreshRecurringGaps();
    console.log(`فروقٌ تتكرّر: ${found.length}`);
    for (const g of found) console.log(`   ${g.name.padEnd(26)} ${g.kind.padEnd(15)} ${r(g.totalMinor)} في ${g.months.join("،")}${g.byWitness ? " (بشاهد فودكس)" : ""}`);
    process.exit(0);
  }
  const only = process.argv[2];
  const months = only ? [only] : ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
  for (const m of months) printFlow(m, await loadMonthStockFlow(m), Boolean(only));
  if (!only) {
    const all = await loadCumulativeStockFlow();
    if (all) printFlow("تراكميّ", all, false);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
