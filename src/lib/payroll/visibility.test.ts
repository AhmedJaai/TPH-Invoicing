import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { can, ROLES, type Role } from "@/lib/permissions";
import { buildAccountantPack, redactPackSalaries, summarize, type PackInput } from "@/lib/accountant-pack";
import { collapseSalaryRows, HIDDEN_SALARY_LABEL, seesSalaries, withoutSalaryRows } from "./visibility";

/**
 * الرواتب للمالك وحده (أحمد، ٢٤ أكتوبر ٢٠٢٦): المحاسبُ والمراجع لا يقرآن راتبَ أحدٍ ولا اسمَه —
 * لا في «الموظفون»، ولا في كشف البنك، ولا في المصروفات، ولا في تفصيل قائمة الدخل، ولا في
 * حزمة المحاسب، ولا في البحث. والمجموعُ يبقى سطراً واحداً حيث يُجمع الباب.
 */

const NOT_OWNER: Role[] = ["ACCOUNTANT", "AUDITOR", "PURCHASING"];

describe("الصلاحيّة نفسها", () => {
  it("المالكُ وحده يملك رؤيةَ الرواتب وتعديلَها", () => {
    for (const r of ROLES) {
      expect(can(r, "payroll:view")).toBe(r === "OWNER");
      expect(can(r, "payroll:edit")).toBe(r === "OWNER");
      expect(seesSalaries(r)).toBe(r === "OWNER");
    }
  });
});

const pack: PackInput = {
  month: "2026-09", monthLabel: "سبتمبر 2026", generatedAt: "2026-10-01", closed: false,
  invoices: [], payments: [],
  expenses: [
    { date: "2026-09-27", category: "SALARY", label: "راتب الوليد", amountMinor: 350_000, source: "BANK" },
    { date: "2026-09-27", category: "SALARY", label: "راتب صالح", amountMinor: 300_000, source: "BANK" },
    { date: "2026-09-02", category: "RENT", label: "إيجار", amountMinor: 900_000, source: "BANK" },
  ],
  bank: [
    { date: "2026-09-27", description: "BEN ID ALWALEED SALEH", direction: "DEBIT", amountMinor: 350_000, category: "SALARY", matched: false },
    { date: "2026-09-27", description: "BEN ID SALEH AHMED", direction: "DEBIT", amountMinor: 300_000, category: "SALARY", matched: false },
    { date: "2026-09-02", description: "EJAR", direction: "DEBIT", amountMinor: 900_000, category: "RENT", matched: false },
  ],
};

const cellsOf = (p: PackInput): string => JSON.stringify(buildAccountantPack(p));

describe("حزمةُ المحاسب", () => {
  it.each(NOT_OWNER)("%s: لا اسمَ موظّفٍ ولا راتبَه في أيّ ورقة — والمجموعُ سطرٌ واحد", (role) => {
    const out = redactPackSalaries(pack, role);
    const text = cellsOf(out);
    expect(text).not.toContain("ALWALEED");
    expect(text).not.toContain("SALEH");
    expect(text).not.toContain("الوليد");
    expect(text).not.toContain("3,500.00");
    expect(text).not.toContain("3500.00");
    expect(out.bank.filter((b) => b.category === "SALARY")).toEqual([
      expect.objectContaining({ description: HIDDEN_SALARY_LABEL, amountMinor: 650_000 }),
    ]);
    expect(out.expenses.filter((e) => e.category === "SALARY")).toEqual([
      expect.objectContaining({ label: HIDDEN_SALARY_LABEL, amountMinor: 650_000 }),
    ]);
    /* والمجاميعُ كما هي — الحزمةُ تتوازن */
    expect(summarize(out).bankOutMinor).toBe(summarize(pack).bankOutMinor);
    expect(summarize(out).expensesMinor).toBe(summarize(pack).expensesMinor);
  });

  it("المالكُ يراها كما هي", () => {
    expect(redactPackSalaries(pack, "OWNER")).toEqual(pack);
  });
});

describe("الحجبُ والجمع", () => {
  const rows = [
    { category: "SALARY", amountMinor: 100 },
    { category: "RENT", amountMinor: 50 },
    { category: "SALARY", amountMinor: 200 },
  ];

  it("يُسقط سطورَ الرواتب ويعدّها لغير المالك", () => {
    expect(withoutSalaryRows(rows, "ACCOUNTANT", (r) => r.amountMinor)).toEqual({ rows: [rows[1]], hidden: { count: 2, totalMinor: 300 } });
    expect(withoutSalaryRows(rows, "OWNER", (r) => r.amountMinor).hidden.count).toBe(0);
  });

  it("ويجمعها سطراً واحداً في موضع أوّلها، والمجموعُ لا يتغيّر", () => {
    const out = collapseSalaryRows(rows, "AUDITOR", (t) => ({ category: "SALARY", amountMinor: t }));
    expect(out).toEqual([{ category: "SALARY", amountMinor: 300 }, { category: "RENT", amountMinor: 50 }]);
    expect(collapseSalaryRows(rows, "OWNER", () => ({ category: "X", amountMinor: 0 }))).toEqual(rows);
  });
});

/* ── كلُّ بابٍ يعرض الرواتب يسأل الصلاحيّة — يُقرأ من الشيفرة فلا يُنسى بابٌ جديد ── */

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(full);
  }
  return out;
}

describe("أبوابُ الرواتب محروسة", () => {
  it("كلُّ مسارٍ تحت /api/payroll يبدأ بحارسٍ على payroll:", () => {
    const routes = walk("src/app/api/payroll").filter((f) => f.endsWith("route.ts"));
    expect(routes.length).toBeGreaterThan(0);
    for (const f of routes) expect(readFileSync(f, "utf8"), f).toMatch(/guard\("[^"]+", "payroll:(view|edit)"\)/);
  });

  it("كلُّ صفحةٍ تحت /payroll تسأل payroll:view", () => {
    const pages = walk("src/app/(app)/payroll").filter((f) => f.endsWith("page.tsx"));
    expect(pages.length).toBeGreaterThan(0);
    for (const f of pages) expect(readFileSync(f, "utf8"), f).toContain(`can(user.role, "payroll:view")`);
  });

  it.each([
    ["src/app/(app)/bank/page.tsx", "seesSalaries(user.role)"],
    ["src/app/(app)/bank/tx/[id]/tx-view.tsx", "seesSalaries(user.role)"],
    ["src/app/(app)/money/expenses/page.tsx", "seesSalaries(user.role)"],
    ["src/app/(app)/finance/rows/page.tsx", "visibleOpexRows(view.opexRows, user.role)"],
    ["src/app/(app)/finance/report/page.tsx", "visibleOpexRows(view.opexRows, user.role)"],
    ["src/app/(app)/close/pack/page.tsx", "loadAccountantPack(month, user.role)"],
    ["src/app/api/export/accountant/route.ts", "loadAccountantPack(month, user.role)"],
    ["src/app/api/search/route.ts", `salaries: can(user.role, "payroll:view")`],
    ["src/app/(app)/settings/choices/page.tsx", `loadChoiceLedger(!can(user.role, "payroll:view"))`],
  ])("%s يحجب الرواتب عمّن لا يملكها", (file, needle) => {
    expect(readFileSync(file, "utf8")).toContain(needle);
  });

  it("بنودُ الرواتب في «يحتاج قرارك» تحمل payroll:view", () => {
    const src = readFileSync("src/lib/attention.ts", "utf8");
    for (const id of ["payroll-owed", "payroll-checkins", "payroll-open"]) {
      const at = src.indexOf(`id: "${id}"`);
      expect(at, id).toBeGreaterThan(-1);
      expect(src.slice(at, at + 1200)).toContain(`needs: "payroll:view"`);
    }
  });
});
