import { describe, expect, it } from "vitest";
import { describeFailure } from "./foodics-sync.service";

describe("سببُ سقوط المزامنة يُقال لا نصُّ الاستعلام", () => {
  it("خطأُ القاعدة تحت غلاف Drizzle ← رسالتُه واسمُ القيد", () => {
    const cause = Object.assign(new Error('duplicate key value violates unique constraint "sales_uniq"'), { constraint: "sales_uniq" });
    const wrapped = new Error('Failed query: insert into "sales" ("id", …) values ($1, …)\nparams: a,b,c', { cause });
    expect(describeFailure(wrapped)).toBe('duplicate key value violates unique constraint "sales_uniq" (sales_uniq)');
  });

  it("وبلا سبب ← سطرُه الأوّل وحده، بلا المعاملات", () => {
    const e = new Error('Failed query: select 1\nparams: x');
    expect(describeFailure(e)).toBe("Failed query: select 1");
  });

  it("وغيرُ ذلك ← رسالتُه كما هي", () => {
    expect(describeFailure(new Error("فودكس ردّ 503"))).toBe("فودكس ردّ 503");
    expect(describeFailure("نصّ")).toBe("نصّ");
  });
});
