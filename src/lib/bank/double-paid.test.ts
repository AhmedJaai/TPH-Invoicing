import { describe, expect, it } from "vitest";
import {
  findDoublePaid, payeeKey, recoverableMinor, type DoublePaidTx,
} from "./double-paid";

const tx = (o: Partial<DoublePaidTx> & { id: string }): DoublePaidTx => ({
  valueDate: new Date("2026-07-15T00:00:00Z"),
  amountMinor: 169939,
  direction: "DEBIT",
  description: null,
  beneficiaryRaw: null,
  category: "UTILITY",
  operationRef: null,
  ...o,
});

/* ═══════════════════════════════════════════════════════════════
   وُجدت في مراجعة أحمد لا في النظام

   ‏١٥ يوليو ٢٠٢٦: ثلاث فواتير مرافق سُدّدت كلٌّ منها مرّتين في اليوم
   نفسه بمرجعَي سدادٍ مختلفين — ١٬٦٩٩٫٣٩ و٣٦٣٫٨٨ و٢٨٧٫٥٠ — أي
   ‏٢٬٣٥٠٫٧٧ ريالاً قابلةً للاسترداد. وكان النظام يتخطّى بابَي المرافق
   والحكومة أصلاً، ويكتب في «ما يحتاج انتباهك» صفراً بيده.
   ═══════════════════════════════════════════════════════════════ */
describe("الفاتورة سُدّدت مرّتين", () => {
  it("عدّادُ كهرباءٍ واحد سُدّد مرّتين بمرجعين ← يُطالَب بالفرق", () => {
    const g = findDoublePaid([
      tx({
        id: "a", amountMinor: 169939, operationRef: "SADAD:6898286045",
        description: "Saudi Energy رقم السداد30151604771 هاتف الأهلي مرجع سداد6898286045",
      }),
      tx({
        id: "b", amountMinor: 169939, operationRef: "SADAD:6898287292",
        description: "Saudi Energy رقم السداد30151604771 هاتف الأهلي مرجع سداد6898287292",
      }),
    ]);

    expect(g).toHaveLength(1);
    expect(g[0].transactions).toHaveLength(2);
    /* ما زاد عن مرّةٍ واحدة — لا المجموع */
    expect(g[0].excessMinor).toBe(169939);
    expect(g[0].distinctOperations).toBe(true);
  });

  it("وعدّادان مختلفان في اليوم نفسه ليسا تكراراً", () => {
    expect(findDoublePaid([
      tx({ id: "a", description: "Saudi Energy رقم السداد30151604771 مرجع سداد1" }),
      tx({ id: "b", description: "Saudi Energy رقم السداد30151604726 مرجع سداد2" }),
    ])).toHaveLength(0);
  });

  it("ومرجعُ السداد المختلف لا يفرّق الجهة — هو ما يُثبت أنّهما اثنان", () => {
    const a = tx({ id: "a", description: "STC رقم السداد05280028829 مرجع سداد6898286021" });
    const b = tx({ id: "b", description: "STC رقم السداد05280028829 مرجع سداد6898287323" });
    expect(payeeKey(a)).toBe(payeeKey(b));
  });

  it("ورسمُ القناة الرقميّة يتكرّر عادةً لا خطأً", () => {
    const fee = { amountMinor: 50, category: "BANK_FEE", description: "CITY:Digital Channel" };
    expect(findDoublePaid([
      tx({ id: "a", ...fee }), tx({ id: "b", ...fee }), tx({ id: "c", ...fee }),
    ])).toHaveLength(0);
  });

  it("وما دون ريالين لا يُطالَب به", () => {
    const small = { amountMinor: 150, category: "OTHER", beneficiaryRaw: "جهة ما" };
    expect(findDoublePaid([tx({ id: "a", ...small }), tx({ id: "b", ...small })]))
      .toHaveLength(0);
  });

  it("والواردُ ليس سداداً", () => {
    const inbound = { direction: "CREDIT" as const, beneficiaryRaw: "شبكة" };
    expect(findDoublePaid([tx({ id: "a", ...inbound }), tx({ id: "b", ...inbound })]))
      .toHaveLength(0);
  });

  it("ويومان مختلفان ليسا تكراراً — الفاتورة تُدفَع كلّ شهر", () => {
    expect(findDoublePaid([
      tx({ id: "a", beneficiaryRaw: "شركة الكهرباء", valueDate: new Date("2026-07-15T00:00:00Z") }),
      tx({ id: "b", beneficiaryRaw: "شركة الكهرباء", valueDate: new Date("2026-08-15T00:00:00Z") }),
    ])).toHaveLength(0);
  });

  it("والمرجعُ الغائب في الطرفين يُبقي الاحتمال ولا يقطع", () => {
    const g = findDoublePaid([
      tx({ id: "a", category: "SUPPLIER", beneficiaryRaw: "مؤسسة زاكوباك", amountMinor: 50000 }),
      tx({ id: "b", category: "SUPPLIER", beneficiaryRaw: "مؤسسة زاكوباك", amountMinor: 50000 }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0].distinctOperations).toBe(false);
  });

  it("والمجموع يوم أحمد: ثلاثُ فواتيرٍ ← ٢٬٣٥٠٫٧٧", () => {
    const pair = (id: string, sub: string, ref: string, amount: number) =>
      tx({
        id, amountMinor: amount, operationRef: `SADAD:${ref}`,
        description: `رقم السداد${sub} هاتف الأهلي مرجع سداد${ref}`,
      });

    const groups = findDoublePaid([
      pair("a", "30151604771", "1", 169939), pair("b", "30151604771", "2", 169939),
      pair("c", "30151604726", "3", 36388), pair("d", "30151604726", "4", 36388),
      pair("e", "05280028829", "5", 28750), pair("f", "05280028829", "6", 28750),
    ]);

    expect(groups).toHaveLength(3);
    expect(recoverableMinor(groups)).toBe(235077);
    /* بالمال لا بالتاريخ */
    expect(groups[0].excessMinor).toBe(169939);
  });

  it("وثلاثُ مرّاتٍ تعني زائدتين لا واحدة", () => {
    const same = { beneficiaryRaw: "جهةٌ ما", amountMinor: 100000, category: "OTHER" };
    const g = findDoublePaid([
      tx({ id: "a", ...same }), tx({ id: "b", ...same }), tx({ id: "c", ...same }),
    ]);
    expect(g[0].excessMinor).toBe(200000);
  });
});
