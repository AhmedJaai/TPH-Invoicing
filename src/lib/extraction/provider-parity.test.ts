import { describe, expect, it } from "vitest";
import { extractionSchema } from "./schema";
import { GEMINI_SCHEMA } from "./provider-gemini";
import { NARROW_ALIASES, schemaFor } from "./schemas-by-kind";
import { DOCUMENT_KINDS } from "./schema";

/**
 * تكافؤُ المزوّدين — أن يُسأل كلٌّ عن الشيء نفسه.
 *
 * مسارُ Claude يصنّف المستند ثمّ يطلب مخطّط نوعه وحده، ومزوّد جيميني
 * يحمل مخطّطاً **مكتوباً بيده** لكلّ الأنواع معاً. ومخطّطُ جيميني مكتوبٌ
 * يدوياً لسببٍ صحيح — فهو يقبل مجموعةً فرعية من OpenAPI ويرفض ما
 * يولّده zod. لكنّ اليدويّ يفترق عن مصدره بلا صوت:
 *
 *   يُضاف حقلٌ إلى `schema.ts` فيسأل عنه Claude ولا يسأل عنه جيميني،
 *   ثمّ يُقارَن دقّتهما ويُقال «جيميني أضعف» — وهو لم يُسأل أصلاً.
 *
 * فهذه الاختبارات تجعل الافتراق **يكسر البناء** بدل أن يمرّ صامتاً.
 * وهي لا تُلغي اليدويّ ولا تولّده؛ تُلزمه أن يبقى موازياً.
 */
describe("تكافؤ المزوّدين في العقد", () => {
  const zodKeys = Object.keys(extractionSchema.shape).sort();
  const geminiKeys = Object.keys(GEMINI_SCHEMA.properties).sort();

  it("جيميني يُسأل عن كلّ حقلٍ في المخطّط المشترك", () => {
    const missing = zodKeys.filter((k) => !geminiKeys.includes(k));
    expect(missing, `حقولٌ في المخطّط المشترك ولا يسأل عنها جيميني: ${missing.join("، ")}`)
      .toEqual([]);
  });

  it("ولا يسأل عن حقلٍ لا وجود له في المخطّط المشترك", () => {
    const extra = geminiKeys.filter((k) => !zodKeys.includes(k));
    expect(extra, `حقولٌ يسأل عنها جيميني ولا مكان لها: ${extra.join("، ")}`)
      .toEqual([]);
  });

  it("وأنواع المستندات المعروضة عليه هي الأنواع المعرَّفة", () => {
    const kinds = [...(GEMINI_SCHEMA.properties.documentKind.enum as readonly string[])].sort();
    expect(kinds).toEqual([...DOCUMENT_KINDS].sort());
  });

  it("ولا يُسأل عن حقلٍ يُطرَح جوابُه", () => {
    /*
      حقلُ النوع إمّا أن يكون في المخطّط المشترك، وإمّا أن يكون اسماً
      يترجمه `widen` إليه. وما ليس هذا ولا ذاك يُسأل عنه النموذج ثمّ
      يُرمى — وهو يُشتّت انتباهه ويُوهم قارئ الشيفرة أنّه مستعمَل.
    */
    const allowed = new Set<string>([...zodKeys, ...NARROW_ALIASES]);
    for (const kind of DOCUMENT_KINDS) {
      const stray = Object.keys(schemaFor(kind).shape).filter((k) => !allowed.has(k));
      expect(stray, `${kind}: يُسأل عنها ثمّ تُطرَح — ${stray.join("، ")}`).toEqual([]);
    }
  });
});
