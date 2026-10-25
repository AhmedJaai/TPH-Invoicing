import { describe, expect, it } from "vitest";
import { endpointOf, resettableBranch, testDatabaseProblem } from "../../scripts/lib/test-env";

const PROD = "postgresql://u:p@ep-wandering-bread-ael4pgk9-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require";
const PROD_DIRECT = "postgresql://u:p@ep-wandering-bread-ael4pgk9.c-2.us-east-2.aws.neon.tech/neondb";
const TEST = "postgresql://u:p@ep-small-recipe-aepu06u9-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require";

describe("بيئةُ الاختبار لا تقع على الإنتاج", () => {
  it("النقطةُ المجمَّعة والمباشرة لفرعٍ واحد مضيفٌ واحد", () => {
    expect(endpointOf(PROD)).toBe(endpointOf(PROD_DIRECT));
  });

  it("ترفض وجهةَ الإنتاج مجمَّعةً كانت أو مباشرة", () => {
    expect(testDatabaseProblem(PROD, PROD)).toMatch(/الإنتاج/);
    expect(testDatabaseProblem(PROD_DIRECT, PROD)).toMatch(/الإنتاج/);
  });

  it("ترفض الوجهةَ الغائبة أو غير المقروءة", () => {
    expect(testDatabaseProblem(undefined, PROD)).not.toBeNull();
    expect(testDatabaseProblem("not a url", PROD)).not.toBeNull();
  });

  it("تقبل فرعاً غير الإنتاج", () => {
    expect(testDatabaseProblem(TEST, PROD)).toBeNull();
  });

  it("لا يُعاد فرعُ الإنتاج ولا فرعٌ بلا معرّف", () => {
    expect(resettableBranch("br-twilight-voice-aeaetbk8", "br-twilight-voice-aeaetbk8")).not.toBeNull();
    expect(resettableBranch(undefined, "br-twilight-voice-aeaetbk8")).not.toBeNull();
    expect(resettableBranch("br-plain-frost-ae4vqb0e", "br-twilight-voice-aeaetbk8")).toBeNull();
  });
});
