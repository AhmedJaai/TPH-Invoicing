/**
 * رواتبُ مايو–أغسطس ٢٠٢٦ كما سجّلها أحمد بيده (جدول «الرواتب — مايو إلى أغسطس ٢٠٢٦»، ٢٣ أكتوبر ٢٠٢٦).
 *
 * يكتب بخدمات التطبيق نفسها (`payroll.service.ts`) فيمرّ بحرّاسها وسجلّ التدقيق: الموظّفون، وراتبُ كلّ
 * شهرٍ كما دُفع في الجدول (يعدّله أحمد بعد)، وتوزيعُ كلّ حوالةٍ ذكرها الجدول على صاحبها راتباً، وما
 * «لم يظهر في البنك» بنداً «دُفع خارج الكشف».
 *
 * لا يُخترع شيء: حوالةٌ لم يسمّها الجدول لا تُوزَّع (٤٬٤٥٥ لحساب المالك في ٣١ يوليو «تأكد أنه موّل
 * بقيّة الموظفين» — لم يتأكّد)، ورسومُ خدمة الرواتب ليست موظّفاً. ومجموعُ مايو في الجدول ١٧٬٤٦٥٫٠١
 * والحوالةُ ١٧٬٤٦٥٫٠٠ («فرق هللة»): نقصت هللةٌ من عبدالله كي لا يتجاوز التوزيعُ الحوالة.
 *
 * يُعطي النتيجةَ نفسها إن شُغِّل مرّتين: الموظّفُ يُعرف برقم المستفيد أو باسمه، والتوزيعُ والبندُ لا يُكرَّران.
 *
 *   npx tsx --env-file=.env scripts/import-payroll-2026-10-23.ts [--i-know-this-is-production]
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { employeeRates, employees, payrollAdjustments, payrollLinks } from "@/db/schema";
import { addAdjustment, linkTransfer, saveEmployee, setRate, type EmployeeInput } from "@/services/payroll.service";
import { parseRiyals } from "@/lib/money";
import { writeAllowed } from "./lib/guard-write";

const WRITE = writeAllowed();
const SHEET = "من جدول أحمد للرواتب (مايو–أغسطس)";

interface Person {
  key: string;
  name: string;
  ben: string | null;
  hiredOn: string;
  leftOn: string | null;
  /** راتبُ كلّ شهرٍ كما دُفع في الجدول — `null`: لا يُمسّ راتبُه (أدخله أحمد بنفسه). */
  rates: Record<string, string> | null;
}

const PEOPLE: Person[] = [
  { key: "abdullah", name: "عبدالله", ben: null, hiredOn: "2026-05-01", leftOn: "2026-06-30", rates: { "2026-05": "3721.66", "2026-06": "1050" } },
  { key: "adnan", name: "عدنان", ben: null, hiredOn: "2026-05-01", leftOn: "2026-06-30", rates: { "2026-05": "3050", "2026-06": "2500" } },
  { key: "baraa", name: "البراء محمد يسلم الجعيدي", ben: "2216139259", hiredOn: "2026-05-01", leftOn: null, rates: { "2026-05": "3650", "2026-06": "3000", "2026-07": "3000", "2026-08": "3500" } },
  { key: "anas", name: "أنس أمين سليمان محمد", ben: "2189742550", hiredOn: "2026-05-01", leftOn: null, rates: null },
  { key: "makram", name: "مكرم", ben: null, hiredOn: "2026-05-01", leftOn: null, rates: { "2026-05": "1501.67", "2026-06": "1870", "2026-08": "1940" } },
  { key: "aban", name: "أبان", ben: null, hiredOn: "2026-05-01", leftOn: null, rates: { "2026-05": "1250", "2026-06": "1900", "2026-08": "640" } },
  { key: "waleed", name: "الوليد محمد علي بامخشب", ben: "1129311518", hiredOn: "2026-05-01", leftOn: null, rates: { "2026-05": "1166.67", "2026-06": "2800", "2026-07": "3000", "2026-08": "2200" } },
  { key: "ahmed", name: "أحمد الجعيدي", ben: null, hiredOn: "2026-06-01", leftOn: null, rates: { "2026-06": "5500", "2026-08": "4500" } },
  { key: "saleh", name: "صالح نزار بن صالح كيكي", ben: "1101486148", hiredOn: "2026-06-01", leftOn: null, rates: { "2026-06": "1633", "2026-07": "2500", "2026-08": "3500" } },
  { key: "abdulrahman", name: "عبدالرحمن أحمد بلخير", ben: "1115891903", hiredOn: "2026-07-01", leftOn: null, rates: { "2026-07": "2000", "2026-08": "1000" } },
  { key: "mohammed", name: "محمد", ben: null, hiredOn: "2026-08-01", leftOn: null, rates: { "2026-08": "1284" } },
  { key: "ziyad", name: "زياد", ben: null, hiredOn: "2026-08-01", leftOn: null, rates: { "2026-08": "3000" } },
  { key: "mansour", name: "منصور", ben: null, hiredOn: "2026-08-01", leftOn: null, rates: { "2026-08": "960" } },
];

/** حوالةٌ في الكشف بيومها ومبلغها وبابها — وما يُوزَّع منها لمن، وعن أيّ شهر. */
const TRANSFERS: { day: string; amount: string; category: "SALARY" | "PERSONAL"; parts: { who: string; month: string; amount: string }[] }[] = [
  { day: "2026-05-30", amount: "17465", category: "PERSONAL", parts: [
    { who: "abdullah", month: "2026-05", amount: "3721.66" }, { who: "adnan", month: "2026-05", amount: "3050" },
    { who: "baraa", month: "2026-05", amount: "3650" }, { who: "anas", month: "2026-05", amount: "3125" },
    { who: "makram", month: "2026-05", amount: "1501.67" }, { who: "aban", month: "2026-05", amount: "1250" },
    { who: "waleed", month: "2026-05", amount: "1166.67" },
  ] },
  { day: "2026-06-30", amount: "5500", category: "PERSONAL", parts: [{ who: "ahmed", month: "2026-06", amount: "5500" }] },
  { day: "2026-06-30", amount: "3000", category: "SALARY", parts: [{ who: "baraa", month: "2026-06", amount: "3000" }] },
  { day: "2026-06-30", amount: "2800", category: "SALARY", parts: [{ who: "waleed", month: "2026-06", amount: "2800" }] },
  { day: "2026-06-30", amount: "11453", category: "PERSONAL", parts: [
    { who: "anas", month: "2026-06", amount: "2500" }, { who: "adnan", month: "2026-06", amount: "2500" },
    { who: "aban", month: "2026-06", amount: "1900" }, { who: "makram", month: "2026-06", amount: "1870" },
    { who: "saleh", month: "2026-06", amount: "1633" }, { who: "abdullah", month: "2026-06", amount: "1050" },
  ] },
  { day: "2026-07-31", amount: "5500", category: "PERSONAL", parts: [{ who: "ahmed", month: "2026-07", amount: "5500" }] },
  { day: "2026-07-31", amount: "3000", category: "SALARY", parts: [{ who: "baraa", month: "2026-07", amount: "3000" }] },
  { day: "2026-07-31", amount: "3000", category: "SALARY", parts: [{ who: "waleed", month: "2026-07", amount: "3000" }] },
  { day: "2026-07-31", amount: "2500", category: "SALARY", parts: [{ who: "saleh", month: "2026-07", amount: "2500" }] },
  { day: "2026-07-31", amount: "2165.75", category: "SALARY", parts: [{ who: "anas", month: "2026-07", amount: "2165.75" }] },
  { day: "2026-08-02", amount: "2000", category: "SALARY", parts: [{ who: "abdulrahman", month: "2026-07", amount: "2000" }] },
  { day: "2026-08-21", amount: "2200", category: "SALARY", parts: [{ who: "waleed", month: "2026-08", amount: "2200" }] },
  { day: "2026-08-27", amount: "3500", category: "SALARY", parts: [{ who: "saleh", month: "2026-08", amount: "3500" }] },
  { day: "2026-08-27", amount: "3500", category: "SALARY", parts: [{ who: "baraa", month: "2026-08", amount: "3500" }] },
  { day: "2026-08-27", amount: "1750", category: "SALARY", parts: [{ who: "anas", month: "2026-08", amount: "1750" }] },
  { day: "2026-08-27", amount: "1000", category: "SALARY", parts: [{ who: "abdulrahman", month: "2026-08", amount: "1000" }] },
  { day: "2026-08-27", amount: "10724", category: "PERSONAL", parts: [{ who: "ahmed", month: "2026-08", amount: "4500" }] },
];

/** «غير ظاهر في البنك» — دُفع من حساب المالك بلا حوالةٍ تُعرف. */
const OUTSIDE: { who: string; month: string; amount: string }[] = [
  { who: "mohammed", month: "2026-08", amount: "1284" }, { who: "ziyad", month: "2026-08", amount: "3000" },
  { who: "makram", month: "2026-08", amount: "1940" }, { who: "mansour", month: "2026-08", amount: "960" },
  { who: "aban", month: "2026-08", amount: "640" },
];

const minor = (s: string): number => {
  const m = parseRiyals(s);
  if (m === null) throw new Error(`مبلغ غير مقروء: ${s}`);
  return m;
};

async function main() {
  const [owner] = (await db.execute<{ id: string }>(sql`select id from users where role = 'OWNER' order by created_at limit 1`)).rows;
  if (!owner) throw new Error("لا مالك في القاعدة");
  const actor = owner.id;
  const ids = new Map<string, string>();

  console.log(WRITE ? "— كتابة —" : "— عرضٌ فقط (أضف --i-know-this-is-production للكتابة) —");
  for (const p of PEOPLE) {
    const [found] = p.ben
      ? await db.select({ id: employees.id }).from(employees).where(eq(employees.bankBeneficiaryId, p.ben)).limit(1)
      : await db.select({ id: employees.id }).from(employees).where(eq(employees.name, p.name)).limit(1);
    if (found) { ids.set(p.key, found.id); console.log(`  موجود: ${p.name}`); }
    else {
      console.log(`  + موظف: ${p.name}${p.leftOn ? ` (ترك ${p.leftOn})` : ""}`);
      if (WRITE) {
        const input: EmployeeInput = {
          name: p.name, kind: "MONTHLY", jobTitle: null, phone: null, nationalId: null, bankBeneficiaryId: p.ben, iban: null,
          hiredOn: p.hiredOn, leftOn: p.leftOn, shiftStart: null, shiftMinutes: 480, lateGraceMinutes: 0, daysOff: "", note: SHEET,
        };
        ids.set(p.key, await saveEmployee(null, input, null, actor));
      }
    }
    if (!p.rates) continue;
    for (const [month, amount] of Object.entries(p.rates)) {
      const id = ids.get(p.key);
      const [has] = id ? await db.select({ a: employeeRates.amountMinor }).from(employeeRates).where(and(eq(employeeRates.employeeId, id), eq(employeeRates.fromMonth, month))).limit(1) : [];
      if (has?.a === minor(amount)) continue;
      console.log(`    راتب ${p.name} من ${month}: ${amount}`);
      if (WRITE && id) await setRate(id, month, minor(amount), actor);
    }
  }

  for (const t of TRANSFERS) {
    const candidates = (await db.execute<{ id: string }>(sql`
      select id from bank_transactions
       where direction = 'DEBIT' and category = ${t.category} and amount_minor = ${minor(t.amount)}
         and to_char(value_date at time zone 'Asia/Riyadh', 'YYYY-MM-DD') = ${t.day}
       order by id`)).rows;
    for (const part of t.parts) {
      const who = PEOPLE.find((p) => p.key === part.who)!;
      const empId = ids.get(part.who);
      /* حوالتا راتبٍ بالمبلغ نفسه في اليوم نفسه: صاحبُها يُعرف برقم المستفيد في الخدمة نفسها */
      let done = false;
      for (const c of candidates) {
        const [already] = empId ? await db.select({ id: payrollLinks.id }).from(payrollLinks)
          .where(and(eq(payrollLinks.bankTransactionId, c.id), eq(payrollLinks.employeeId, empId), eq(payrollLinks.month, part.month), isNull(payrollLinks.voidedAt))).limit(1) : [];
        if (already) { done = true; break; }
      }
      if (done) continue;
      if (candidates.length === 0) { console.log(`  ✕ لم توجد حوالة ${t.day} بـ${t.amount} (${t.category})`); continue; }
      console.log(`  ← ${who.name} عن ${part.month}: ${part.amount} من حوالة ${t.day} (${t.amount})`);
      if (!WRITE || !empId) continue;
      let lastError: unknown = null;
      for (const c of candidates) {
        try {
          await linkTransfer({ employeeId: empId, month: part.month, purpose: "SALARY", bankTransactionId: c.id, amountMinor: minor(part.amount), note: SHEET }, actor);
          lastError = null;
          break;
        } catch (e) { lastError = e; }
      }
      if (lastError) console.log(`    ✕ ${lastError instanceof Error ? lastError.message : String(lastError)}`);
    }
  }

  for (const o of OUTSIDE) {
    const who = PEOPLE.find((p) => p.key === o.who)!;
    const empId = ids.get(o.who);
    const [already] = empId ? await db.select({ id: payrollAdjustments.id }).from(payrollAdjustments)
      .where(and(eq(payrollAdjustments.employeeId, empId), eq(payrollAdjustments.month, o.month), eq(payrollAdjustments.kind, "PAID_OUTSIDE"), isNull(payrollAdjustments.voidedAt))).limit(1) : [];
    if (already) continue;
    console.log(`  ⊙ ${who.name} عن ${o.month}: ${o.amount} دُفع خارج الكشف`);
    if (WRITE && empId) await addAdjustment({ employeeId: empId, month: o.month, kind: "PAID_OUTSIDE", amountMinor: minor(o.amount), note: "من حساب المالك — غير ظاهر في البنك (جدول أحمد)" }, actor);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
