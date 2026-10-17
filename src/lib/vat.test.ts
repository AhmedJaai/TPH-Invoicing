import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  VAT_PERCENT, grossOfNetExact, grossOfVat, netInsideGross, netOfVat, vatInsideGross, vatMatchesStandardRate, vatOnNet,
} from "./vat";
import { TOTAL_ROUNDING_TOLERANCE_MINOR } from "./money";
import { reconcileInvoiceLines, resolveLinePricing } from "./line-pricing";

/* مبالغُ تمثّل ما يمرّ فعلاً: هللاتٌ مفردة، فواتيرُ صغيرة، وأقصى ما يتّسع له العمود */
const AMOUNTS: number[] = [];
for (let m = 0; m <= 30_000; m++) AMOUNTS.push(m);
for (let m = 30_000; m <= 5_000_000; m += 997) AMOUNTS.push(m);
AMOUNTS.push(57_400, 60_375, 66_010, 1_757_200, 2_147_483_647);

describe("النسبة ١٥٪ في موضع واحد — وتطابق ما كان مكتوباً في كلّ موضع", () => {
  it("١١٥ فيها ١٥، و١٠٠ عليها ١٥", () => {
    expect(VAT_PERCENT).toBe(15);
    expect(vatInsideGross(11_500)).toBe(1_500);
    expect(vatOnNet(10_000)).toBe(1_500);
    expect(netInsideGross(11_500)).toBe(10_000);
    expect(netOfVat(1_500)).toBe(10_000);
    expect(grossOfVat(1_500)).toBe(11_500);
  });

  it("vatOnNet = ما كان في validate-extraction (‎⌊(الصافي×١٥+٥٠)÷١٠٠⌋)", () => {
    for (const s of AMOUNTS) expect(vatOnNet(s)).toBe(Math.floor((s * 15 + 50) / 100));
  });

  it("netInsideGross = ما كان في line-pricing (‎×١٠٠ ÷ (١٠٠ + round(0.15×١٠٠)))", () => {
    const pct = Math.round(0.15 * 100);
    for (const m of AMOUNTS) expect(netInsideGross(m)).toBe(Math.round((m * 100) / (100 + pct)));
  });

  it("netOfVat و grossOfVat = ما كان في vat-return و sales/witness", () => {
    for (const m of AMOUNTS) {
      expect(netOfVat(m)).toBe(Math.round((m * 100) / 15));
      expect(grossOfVat(m)).toBe(Math.round((m * 115) / 15));
    }
  });

  it("vatMatchesStandardRate = ما كان في auto-archive و validate-extraction", () => {
    const tol = TOTAL_ROUNDING_TOLERANCE_MINOR;
    for (let i = 0; i < AMOUNTS.length; i += 7) {
      const s = AMOUNTS[i];
      for (const off of [-tol - 2, -tol - 1, -tol, -1, 0, 1, tol, tol + 1, tol + 2]) {
        const vat = vatOnNet(s) + off;
        expect(vatMatchesStandardRate(s, vat, tol)).toBe(Math.abs(vat * 100 - s * 15) <= tol * 100);
      }
    }
  });
});

/*
 * التغييرُ الوحيد في السلوك — ومكتوبٌ بمثاله.
 *
 * `الصافي × (1 + 0.15)` عائمةٌ: ‎٦٠٫٠٠ × ١٫١٥ = ‎٦٨٫٩٩٩٩٩٩٩٩٩٩٩٩٩٩‎ لا ٦٩٫٠٠. فإجماليٌّ
 * يبعد عن (الصافي + ضريبته) **واحداً بالمئة بالضبط** كان يُردّ «ليس شاملاً الضريبة»
 * لخطأ تمثيلٍ لا لحساب. وما دون الحدّ وما فوقه بهللةٍ لم يتغيّر فيه شيء.
 */
describe("line-pricing: «الإجماليّ شامل الضريبة» بلا عدد عائم", () => {
  const REL = 0.01;
  const near = (a: number, b: number) => (b === 0 ? a === 0 : Math.abs(a - b) / Math.abs(b) <= REL);

  it("الصيغة العائمة كانت تخطئ تمثيل ٦٩٫٠٠", () => {
    expect(6_000 * (1 + 0.15)).not.toBe(6_900);
    expect(grossOfNetExact(6_000)).toBe(6_900);
  });

  it("لا يفترق الحكم عن القديم إلّا عند الحدّ نفسه (١٪ بالضبط)", () => {
    let differ = 0;
    for (let net = 1; net <= 400_000; net++) {
      const before = net * (1 + 0.15);
      const after = grossOfNetExact(net);
      for (const edge of [after * 0.99, after * 1.01]) {
        for (let total = Math.floor(edge) - 1; total <= Math.ceil(edge) + 1; total++) {
          if (near(total, before) === near(total, after)) continue;
          differ++;
          /* الفرقُ عند الحدّ بالضبط وحده، والجديدُ هو الصواب حساباً */
          expect(Math.abs(total * 100 - net * 115) * 100).toBe(net * 115);
          expect(near(total, after)).toBe(true);
        }
      }
    }
    /* نادرٌ: عشراتٌ من مليونَي مقارنةٍ عند الحدّ */
    expect(differ).toBeGreaterThan(0);
    expect(differ).toBeLessThan(200);
  });

  it("السطر الشامل الضريبة يقرأ صافياً كما كان", () => {
    expect(resolveLinePricing({ quantity: 10, unitPriceMinor: 1_000, lineTotalMinor: 11_500 })?.basis).toBe("TOTAL_INCLUDES_VAT");
    expect(resolveLinePricing({ quantity: 10, unitPriceMinor: 1_000, lineTotalMinor: 10_000 })?.basis).toBe("CONSISTENT");
    expect(resolveLinePricing({ quantity: 10, unitPriceMinor: 1_000, lineTotalMinor: 8_855 })?.basis).toBe("DISCOUNTED");
  });

  it("بنود شاملة الضريبة تردّ إلى الصافي ويجمع مجموعها إليه بالهللة", () => {
    const lines = [
      { effectiveUnitMinor: 1_150, netTotalMinor: 11_500, listUnitMinor: null, discountMinor: 0, basis: "CONSISTENT" as const },
      { effectiveUnitMinor: 333, netTotalMinor: 3_833, listUnitMinor: null, discountMinor: 0, basis: "CONSISTENT" as const },
    ];
    const out = reconcileInvoiceLines(lines, 13_333);
    expect(out.lines.reduce((s, l) => s + l.netTotalMinor, 0)).toBe(13_333);
    expect(out.lines[0].effectiveUnitMinor).toBe(1_000);
  });
});

describe("حارس: لا نسبة ضريبة مكتوبةً باليد خارج vat.ts", () => {
  const ROOT = path.resolve(__dirname, "..");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const n of readdirSync(dir)) {
      const f = path.join(dir, n);
      if (statSync(f).isDirectory()) walk(f);
      else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)) files.push(f);
    }
  };
  for (const d of ["lib", "services", "config", "app/api"]) walk(path.join(ROOT, d));

  /* ضربٌ أو قسمةٌ بـ١٥ أو ١١٥، أو `0.15`/`1.15` في عبارةٍ حسابيّة، أو الثابتُ العائم القديم */
  const HAND_RATE = /(?:[*/]\s*(?:15|115)\b(?!\s*[%٪]))|(?:[*/]\s*(?:0\.15|1\.15)\b)|(?:\b(?:0\.15|1\.15)\s*[*/])|\bVAT_RATE\b(?!_)/;

  it("كلّ حساب بالنسبة يمرّ بدوالّ vat.ts", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (f.endsWith(`${path.sep}lib${path.sep}vat.ts`)) continue;
      /* التعليقُ متعدّدُ الأسطر يُفرَّغ ويبقى عددُ أسطره — فرقمُ السطر في الشكوى صحيح */
      const source = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ""));
      source.split("\n").forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, "");
        /* نصٌّ يُعرَض («15/115 من الإجمالي») ليس حساباً */
        const bare = code.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
        if (HAND_RATE.test(bare)) offenders.push(`${path.relative(ROOT, f)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
