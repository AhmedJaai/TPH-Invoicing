import { describe, expect, it } from "vitest";
import { directDatabaseUrl } from "./direct-url";

describe("directDatabaseUrl — الهجراتُ على الاتّصال المباشر", () => {
  it("يُسقط «-pooler» من أوّل المضيف ويُبقي ما سواه", () => {
    expect(directDatabaseUrl("postgresql://u:p@ep-wandering-bread-ael1-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require"))
      .toBe("postgresql://u:p@ep-wandering-bread-ael1.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require");
  });

  it("المباشرُ والمحلّيّ يُعادان كما هما", () => {
    const direct = "postgresql://u:p@ep-dry-river-1.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require";
    expect(directDatabaseUrl(direct)).toBe(direct);
    expect(directDatabaseUrl("postgres://postgres@localhost:5432/tph_test")).toBe("postgres://postgres@localhost:5432/tph_test");
  });

  it("لا يمسّ «pooler» في غير أوّل المضيف", () => {
    const odd = "postgresql://u:p@db.pooler-region.example.com/x";
    expect(directDatabaseUrl(odd)).toBe(odd);
  });

  it("ما ليس رابطاً يُعاد كما هو", () => {
    expect(directDatabaseUrl("not a url")).toBe("not a url");
  });
});
