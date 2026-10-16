import { describe, expect, it } from "vitest";
import { Linter } from "eslint";
import tsParser from "@typescript-eslint/parser";
import tph from "../../eslint-rules/index.mjs";

/**
 * قواعدُ ESLint المحلّيّة تُثبت نفسها: كلُّ قاعدةٍ تُمسك الشكلَ الذي وقع فعلاً،
 * وتترك الصواب — وإلّا كانت طمأنينةً بلا سند.
 *
 * والشجرةُ كلُّها تُفحَص بها في `npm run lint` (وفي `code-guards.test.ts`،
 * فلا يمرّ `npm test` وحده على ما يخالفها).
 */
const linter = new Linter();

function hits(rule: string, code: string, options: unknown[] = [], filename = "src/x.tsx"): string[] {
  const messages = linter.verify(code, {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { tph },
    rules: { [`tph/${rule}`]: ["error", ...options] },
  }, { filename });
  // خطأُ تحليلٍ في المثال نفسِه ليس «لم تُمسك» — يُرمى
  const fatal = messages.find((m) => m.fatal);
  if (fatal) throw new Error(`مثال لا يحلّل: ${fatal.message}`);
  return messages.map((m) => m.ruleId ?? "");
}

const cases = (rule: string, bad: Record<string, string>, good: Record<string, string>, options: unknown[] = []) => {
  for (const [label, code] of Object.entries(bad)) {
    it(`يمسك: ${label}`, () => {
      expect(hits(rule, code, options).length).toBeGreaterThan(0);
    });
  }
  for (const [label, code] of Object.entries(good)) {
    it(`ولا يمسك الصواب: ${label}`, () => {
      expect(hits(rule, code, options)).toEqual([]);
    });
  }
};

describe("tph/no-db-in-transaction", () => {
  cases("no-db-in-transaction", {
    "سهم بجسم": "await db.transaction(async (tx) => { await tx.insert(a); await db.insert(b); });",
    "معامل منمّط": "await db.transaction(async (tx: Tx) => { await db.update(b).set({}); });",
    "سهم بلا async يرجع": "await db.transaction((tx) => { return db.insert(a); });",
    "function": "await db.transaction(async function (tx) { await db.delete(a); });",
    "معامل بلا أقواس": "await db.transaction(async tx => { await db.select().from(a); });",
    "db حجّةً في جسم تعبير": "await db.transaction(async (tx) => write(tx, db));",
    "جسم تعبير مباشر": "await db.transaction((tx) => db.insert(a).values(v));",
    "متداخل في دالّة داخلها": "await db.transaction(async (tx) => { await Promise.all(xs.map((x) => db.insert(x))); });",
    "خاصيّة مختصرة تمرّر db": "await db.transaction(async (tx) => { await recordAudit(entry, { db }); });",
    "معاملة داخل معاملة": "await db.transaction(async (tx) => { await tx.transaction(async (inner) => { await db.insert(a); }); });",
  }, {
    "المقبض وحده": "await db.transaction(async (t) => { await t.insert(a); await t.update(b).set({}); });",
    "مقبض منمّط يمرّر": "await db.transaction((tx: Tx) => markPaidByOwner(tx, invoiceId));",
    "db خارج المعاملة": "const rows = await db.select().from(a); await db.transaction(async (tx) => tx.insert(b));",
    "خاصيّة اسمها db": "await db.transaction(async (tx) => { log({ db: 1 }); cfg.db.name; });",
    "معامل اسمه db يحجب العامّ": "await pool.transaction(async (db) => { await db.insert(a); });",
    "db بعد انتهاء المعاملة": "await db.transaction(async (tx) => { await tx.insert(a); }); await db.insert(b);",
  });
});

describe("tph/no-bare-response-json", () => {
  cases("no-bare-response-json", {
    "الشكل الذي وقع": "const json = await res.json();",
    "اسم آخر للردّ": "const data = await response.json();",
    "مصبوباً": "const data = (await r.json()) as Row[];",
  }, {
    "عبر http-client": "const read = await readJsonResponse(res);",
    "جسم الطلب في الخادم": "const body = await request.json();",
    "نصّاً أوّلاً": "const text = await res.text();",
  });
});

describe("tph/no-raw-error-body", () => {
  cases("no-raw-error-body", {
    "الشكل الذي وقع": "return NextResponse.json({ error: (e as Error).message }, { status: 400 });",
    "باسم آخر للخطأ": "return Response.json({ ok: false, error: (err as Error).message });",
  }, {
    "الخاتمة الموحّدة": "try { run(); } catch (e) { return respondTo(e); }",
    "رسالة مكتوبة": 'return NextResponse.json({ error: "الشهر مقفل" }, { status: 409 });',
    "خطؤنا المنمّط بعد فحصه": "if (e instanceof MonthClosedError) return NextResponse.json({ error: e.message }, { status: 409 });",
  });
});

describe("tph/no-cast-request-body", () => {
  cases("no-cast-request-body", {
    "الشكل الذي وقع": "body = (await request.json()) as Body;",
    "مع catch وافتراض": "const body = ((await request.json().catch(() => ({}))) ?? {}) as Body;",
    "نوعاً مضمّناً": "const body = (await request.json()) as { id: string };",
  }, {
    "readJson": "const read = await readJson(request, Body);",
    "safeParse على unknown": "const parsed = Body.safeParse((await request.json()) as unknown);",
    "صبّ لا علاقة له بالطلب": "const x = (await load()) as Row;",
  });
});

describe("tph/no-column-in-correlated-subquery", () => {
  const options = [{ tables: ["invoices", "payments", "paymentAllocations"] }];
  cases("no-column-in-correlated-subquery", {
    "الشكل الذي وقع في match-confirm":
      "const q = sql`coalesce((select sum(pa.amount_minor) from payment_allocations pa where pa.invoice_id = ${invoices.id}), 0)`;",
    "findPaymentTwin":
      "const q = sql<number>`(select count(*) from payment_allocations pa where pa.payment_id = ${payments.id})`;",
    "تعبير سليم قبله لا يخفيه":
      "const q = sql`(select 1 from ${paymentAllocations} pa where pa.invoice_id = ${invoices.id})`;",
  }, {
    "بالمرجع":
      "const q = sql`coalesce((select sum(pa.amount_minor) from payment_allocations pa where pa.invoice_id = ${invoices}.id), 0)`;",
    "تجميع على الاستعلام الرئيس": "const q = sql`coalesce(sum(${paymentAllocations.amountMinor}),0)::int`;",
    "قيمة من الشيفرة لا عمود": "const q = sql`(select 1 from invoices i where i.id = ${s.id})`;",
    "قالب ليس sql": "const q = text`(select 1 from x where x.id = ${invoices.id})`;",
    "بعد إغلاق الاستعلام الفرعيّ": "const q = sql`(select 1 from x where x.a = 1) + ${invoices.totalMinor}`;",
  }, options);

  it("وبلا خيار يقرأ الجداول من المخطّط نفسه — لا قائمة تكتب باليد", () => {
    const bad = "const q = sql`(select 1 from payment_allocations pa where pa.invoice_id = ${invoices.id})`;";
    expect(hits("no-column-in-correlated-subquery", bad)).toHaveLength(1);
    const unknown = "const q = sql`(select 1 from t where t.id = ${notATable.id})`;";
    expect(hits("no-column-in-correlated-subquery", unknown)).toEqual([]);
  });
});

describe("tph/rename-file-only-in-service", () => {
  cases("rename-file-only-in-service", {
    "نداء مباشر": 'await renameFile(drive, fileId, "اسم");',
    "عبر كائن": 'await driveApi.renameFile(fileId, "اسم");',
  }, {
    "استيراد النوع": 'import type { renameFile } from "@/lib/drive";',
    "الخدمة": "await applyRenames(plan, actor);",
  });
});

describe("tph/no-inline-riyals-format", () => {
  cases("no-inline-riyals-format", {
    "الشكل الذي وقع": "const label = `${(amountMinor / 100).toFixed(2)} ريال`;",
    "بالثابت": "const label = (amountMinor / HALALAS_PER_RIYAL).toFixed(2);",
    "بفواصل الآلاف": 'const riyals = (m: number) => (m / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });',
    "بمنسّق Intl": 'const riyals = (m: number) => new Intl.NumberFormat("en-US").format(m / 100);',
    "بالقيمة المطلقة": 'const riyals = (m: number) => new Intl.NumberFormat("en-US").format(Math.abs(m) / 100);',
    "المطلق خارج القسمة": "const label = Math.abs(m / 100).toFixed(2);",
  }, {
    "للآلة بلا قسمة": "const cell = formatRiyals(amountMinor);",
    "تاريخ لا مال": "const day = DAY_FORMAT.format(d);",
    "عدد بلا قسمة": 'const n = count.toLocaleString("en-US");',
    "المنسّق الواحد": "const label = formatRiyalsDisplay(amountMinor);",
    "نسبة لا مال": "const pct = (bp / 100).toFixed(1);",
    "قسمة أخرى": "const kb = (bytes / 1024).toFixed(2);",
  });
});

describe("tph/no-raw-iso-slice", () => {
  cases("no-raw-iso-slice", {
    "يوم مستند": "const day = tx.valueDate.toISOString().slice(0, 10);",
    "شهر UTC الذي أخطأ «الشهر الجاري»": "const month = new Date().toISOString().slice(0, 7);",
    "بسلسلة اختياريّة": "const day = r.invoiceDate?.toISOString().slice(0, 10) ?? null;",
    "على سطرين": "const since = new Date(t)\n  .toISOString()\n  .slice(0, 10);",
  }, {
    "المخزّن باسمه": "const day = isoDay(tx.valueDate);",
    "الشهر المحاسبيّ": "const month = monthOf(tx.valueDate);",
    "اليوم بتوقيت الرياض": "const today = todayInRiyadh();",
    "قصّ نصّ آخر": "const ref = crypto.randomUUID().slice(0, 8);",
    "قصّ يوم نصّيّ": "const month = day.slice(0, 7);",
    "الطابع كاملاً": "const at = new Date().toISOString();",
  });
});
