import { describe, expect, it } from "vitest";
import {
  checkIsolation, connectionWarnings, environmentOf, parseConnection,
  type DbFingerprint,
} from "./db-identity";

const print = (over: Partial<DbFingerprint>): DbFingerprint => ({
  host: "ep-x-pooler.c-2.us-east-2.aws.neon.tech",
  database: "neondb",
  systemIdentifier: "7000000000000000001",
  pooled: true,
  environment: "production",
  ...over,
});

describe("قراءة سلسلة الاتصال", () => {
  it("تُقرأ بلا كشف كلمة السرّ", () => {
    const c = parseConnection("postgresql://u:secret@ep-a-pooler.neon.tech/neondb?sslmode=require");
    expect(c.host).toBe("ep-a-pooler.neon.tech");
    expect(c.database).toBe("neondb");
    expect(JSON.stringify(c)).not.toContain("secret");
  });

  it("تعرف النقطة المجمَّعة من غيرها", () => {
    expect(parseConnection("postgresql://u:p@ep-a-pooler.neon.tech/db").pooled).toBe(true);
    expect(parseConnection("postgresql://u:p@ep-a.neon.tech/db").pooled).toBe(false);
  });

  it("والغائب لا يُكسِر", () => {
    expect(parseConnection(undefined).host).toBe("—");
    expect(parseConnection("ليست عنواناً").host).toBe("غير صالح");
  });
});

describe("البيئة", () => {
  it("تُقرأ من Vercel", () => {
    expect(environmentOf({ VERCEL: "1", VERCEL_ENV: "production" })).toBe("production");
    expect(environmentOf({ VERCEL: "1", VERCEL_ENV: "preview" })).toBe("preview");
  });

  it("وبلا Vercel فهي تطوير", () => {
    expect(environmentOf({})).toBe("development");
  });

  it("وVercel بلا بيئةٍ معلنة مجهول", () => {
    expect(environmentOf({ VERCEL: "1" })).toBe("unknown");
  });
});

describe("حكم العزل", () => {
  /*
    «لم نرَ تداخلاً» ليست «أثبتنا العزل». وبصمةٌ واحدة لا تُثبت شيئاً.
  */
  it("بصمةٌ واحدة لا تُثبت عزلاً", () => {
    const c = checkIsolation([print({})]);
    expect(c.verdict).toBe("UNKNOWN");
    expect(c.reason).toContain("لا يُثبَت ببصمةٍ واحدة");
  });

  it("عنقودان مختلفان → معزولتان", () => {
    const c = checkIsolation([
      print({ environment: "production", systemIdentifier: "1" }),
      print({ environment: "preview", systemIdentifier: "2" }),
    ]);
    expect(c.verdict).toBe("ISOLATED");
  });

  /* هذا هو الخطر: كلّ نشرٍ تجريبيّ يكتب في مالٍ حقيقيّ */
  it("عنقودٌ واحد لبيئتين → مشتركة، وتُسمّى", () => {
    const c = checkIsolation([
      print({ environment: "production", systemIdentifier: "7" }),
      print({ environment: "preview", systemIdentifier: "7" }),
    ]);
    expect(c.verdict).toBe("SHARED");
    expect(c.collisions).toEqual([["production", "preview"]]);
    expect(c.reason).toContain("البيانات الحقيقية");
  });

  /* المضيف يخدع: لنقطة Neon الواحدة أسماءٌ مجمَّعة وغيرُ مجمَّعة */
  it("الحكم على معرّف العنقود لا على اسم المضيف", () => {
    const c = checkIsolation([
      print({ environment: "production", host: "ep-a-pooler.neon.tech", systemIdentifier: "7" }),
      print({ environment: "preview", host: "ep-a.neon.tech", systemIdentifier: "7" }),
    ]);
    expect(c.verdict).toBe("SHARED");
  });

  it("البيئة نفسها مرّتين ليست تداخلاً", () => {
    const c = checkIsolation([
      print({ environment: "production", systemIdentifier: "7" }),
      print({ environment: "production", systemIdentifier: "7" }),
      print({ environment: "preview", systemIdentifier: "8" }),
    ]);
    expect(c.verdict).toBe("ISOLATED");
  });
});

describe("تحذيرات الاتصال", () => {
  it("غير المجمَّعة تُحذَّر", () => {
    expect(connectionWarnings(print({ pooled: false }))[0]).toContain("غير مجمَّعة");
  });

  it("والمجمَّعة المعروفة بلا تحذير", () => {
    expect(connectionWarnings(print({}))).toEqual([]);
  });
});
