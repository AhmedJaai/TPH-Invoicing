import { describe, expect, it } from "vitest";
import { layoutText } from "./document-input";
import type { PdfWord } from "@/lib/bank/parsers/pdf-text";

/**
 * حارسُ عطبٍ وقع فعلاً.
 *
 * أوّل صياغةٍ أعادت استعمال `groupIntoRows` — وهي مكتوبةٌ لكشوف البنك
 * وترتّب الصفّ من اليمين إلى اليسار دائماً. فخرج اسم المورّد مقلوباً:
 * «Est. Trading Leaves Olive»، ووصفُ البند «1kg Beans Coffee Arabica».
 *
 * والمبالغ سلمت — لأنّ الرقم لا يُقلَب. فكان العطب **صامتاً في الأسماء
 * وحدها**، وهي بالضبط ما تقوم عليه مطابقة المورّدين. ولولا قراءةُ
 * المخرَج بالعين لمرّ: القراءة «نجحت»، والأرقام صحيحة.
 */

/** يبني كلمات صفٍّ واحد بمواضع أفقية متصاعدة. */
function row(y: number, texts: string[]): PdfWord[] {
  return texts.map((text, i) => ({ text, x: i * 50, y, page: 1 }));
}

describe("ترتيب نصّ المستند", () => {
  it("الإنجليزية تبقى بترتيبها", () => {
    const out = layoutText(row(700, ["Olive", "Leaves", "Trading", "Est."]));
    expect(out).toBe("Olive  Leaves  Trading  Est.");
  });

  it("والعربية تُعكَس إلى ترتيبها المنطقيّ", () => {
    /* الموضع البصريّ من اليسار: «للتجارة» أوّلاً، والمنطقيّ عكسه */
    const out = layoutText(row(700, ["للتجارة", "الزيتون", "أوراق", "مؤسسة"]));
    expect(out).toBe("مؤسسة  أوراق  الزيتون  للتجارة");
  });

  /*
    وهذا هو الصفّ الذي كسر الصياغتين معاً: قلبُ الاتجاه دائماً يُصلح
    طرفاً ويُفسد الآخر. والصواب ترتيبٌ بصريّ ثمّ عكسُ السلاسل العربية
    وحدها.
  */
  it("والصفّ ثنائيّ اللغة يصحّ طرفاه معاً", () => {
    const out = layoutText(row(700, ["Seller:", "Olive", "Leaves", "الزيتون", "أوراق", "مؤسسة"]));
    expect(out).toBe("Seller:  Olive  Leaves  مؤسسة  أوراق  الزيتون");
  });

  it("الأرقام لا تُقلَب — وهي التي كانت تُخفي العطب", () => {
    const out = layoutText(row(700, ["Total", "1794.00"]));
    expect(out).toBe("Total  1794.00");
  });

  it("أشكال العرض تُوحَّد فيلتقي الاسم بنفسه", () => {
    /* ﻣﺆﺳﺴﺔ شكلُ عرضٍ، ومؤسسة حروفُها — نصّان مختلفان بايتاً */
    const out = layoutText(row(700, ["ﻣﺆﺳﺴﺔ"]));
    expect(out).toBe("مؤسسة");
  });

  it("العلامة وحدها لا تكسر السلسلة العربية", () => {
    const out = layoutText(row(700, [":", "الزيتون", "أوراق", "مؤسسة"]));
    expect(out).toBe("مؤسسة  أوراق  الزيتون  :");
  });

  it("الصفوف تنزل من الأعلى — محور الصفحة يصعد والقراءة تنزل", () => {
    const words = [...row(700, ["فوق"]), ...row(600, ["تحت"])];
    expect(layoutText(words)).toBe("فوق\nتحت");
  });

  it("والصفحات بترتيبها", () => {
    const words: PdfWord[] = [
      { text: "ثانية", x: 0, y: 700, page: 2 },
      { text: "أولى", x: 0, y: 700, page: 1 },
    ];
    expect(layoutText(words)).toBe("أولى\nثانية");
  });

  it("الكلمات المتقاربة رأسياً صفٌّ واحد", () => {
    const words: PdfWord[] = [
      { text: "أ", x: 0, y: 700, page: 1 },
      { text: "ب", x: 50, y: 701.5, page: 1 },
    ];
    expect(layoutText(words)).toBe("ب  أ");
  });
});
