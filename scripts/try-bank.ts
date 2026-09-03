import { readFileSync } from "node:fs";
import { parseBankStatement } from "@/lib/bank/parse";
import { formatRiyalsDisplay } from "@/lib/money";

const r = parseBankStatement(readFileSync(process.argv[2]));
console.log(`\nالبنك: ${r.bank}   الحساب: ${r.accountNumber ?? "—"}`);
console.log(`الفترة: ${r.periodStart?.toISOString().slice(0,10)} → ${r.periodEnd?.toISOString().slice(0,10)}`);
console.log(`الحركات: ${r.rows.length}   تحذيرات: ${r.warnings.length}\n`);

const debit = r.rows.filter(x => x.direction === "DEBIT");
const credit = r.rows.filter(x => x.direction === "CREDIT");
console.log(`  صادر : ${debit.length} حركة  ${formatRiyalsDisplay(debit.reduce((s,x)=>s+x.amountMinor,0))} ريال`);
console.log(`  وارد : ${credit.length} حركة  ${formatRiyalsDisplay(credit.reduce((s,x)=>s+x.amountMinor,0))} ريال`);

console.log(`\n── أكبر عشر حركات صادرة (المدفوعات للموردين غالباً) ──`);
for (const t of [...debit].sort((a,b)=>b.amountMinor-a.amountMinor).slice(0,10)) {
  console.log(`  ${t.valueDate.toISOString().slice(0,10)}  ${formatRiyalsDisplay(t.amountMinor).padStart(11)}  ${t.transactionType.slice(0,22).padEnd(24)} ${t.description.slice(0,46)}`);
}

console.log(`\n── أنواع الحركات ──`);
const types = new Map<string, number>();
for (const t of r.rows) types.set(t.transactionType, (types.get(t.transactionType) ?? 0) + 1);
for (const [k,v] of [...types].sort((a,b)=>b[1]-a[1]).slice(0,12)) console.log(`  ${String(v).padStart(4)} × ${k}`);

if (r.warnings.length) {
  console.log(`\n── تحذيرات (أوّل ٥) ──`);
  for (const w of r.warnings.slice(0,5)) console.log(`  صف ${w.rowNumber}: ${w.reason} — ${w.raw.slice(0,60)}`);
}
console.log();
