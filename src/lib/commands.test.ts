import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { commandsFor, matchCommands } from "./commands";
import { can } from "./permissions";

const ids = (cs: { id: string }[]) => cs.map((c) => c.id);

describe("commandsFor", () => {
  it("كلُّ أمرٍ يشير إلى صفحةٍ موجودة — لا أمرَ إلى مسارٍ حُذف", () => {
    for (const c of commandsFor("OWNER")) {
      const path = c.href.split("#")[0];
      const file = path === "/" ? "src/app/(app)/(home)/page.tsx" : `src/app/(app)${path}/page.tsx`;
      expect(existsSync(join(process.cwd(), file)), `${c.id} → ${file}`).toBe(true);
    }
  });

  it("المعرّفاتُ والمسارات لا تتكرّر بين الصفحات", () => {
    const pages = commandsFor("OWNER").filter((c) => c.group === "PAGE");
    expect(new Set(pages.map((p) => p.href)).size).toBe(pages.length);
    const all = commandsFor("OWNER");
    expect(new Set(ids(all)).size).toBe(all.length);
  });

  it("مديرُ المشتريات لا يرى أمراً لا يملكه — لا بنك ولا دفعة ولا إقفال", () => {
    const got = commandsFor("PURCHASING");
    for (const c of got) if (c.needs) expect(can("PURCHASING", c.needs), c.id).toBe(true);
    const hrefs = got.map((c) => c.href);
    expect(hrefs).not.toContain("/payments");
    expect(hrefs).not.toContain("/close");
    expect(hrefs.some((h) => h.startsWith("/bank"))).toBe(false);
    // ويرى ما يعمل به فعلاً
    expect(hrefs).toContain("/upload");
    expect(hrefs).toContain("/inventory");
  });

  it("لسانٌ في مساحةٍ مغلقة لا يُعرض — «الفواتير» تحت «المورّدين» المحروسة بالمبالغ", () => {
    expect(commandsFor("PURCHASING").map((c) => c.href)).not.toContain("/purchases/invoices");
  });

  it("المالك يرى كلّ فعل", () => {
    expect(ids(commandsFor("OWNER"))).toEqual(
      expect.arrayContaining(["upload", "bank-import", "pay-run", "close-month", "count", "sales-import", "cash", "accountant-pack"]),
    );
  });

  it("أفعالُ الواجهة لا تنتقل — تحمل حدثها ووجهةً موجودة", () => {
    const view = commandsFor("OWNER").filter((c) => c.event);
    expect(view.map((c) => c.event).sort()).toEqual(["amounts", "shortcuts", "theme"]);
    for (const c of view) expect(c.href).toBe("/");
  });

  it("النقدُ القادم لمن يرى البنك وحده", () => {
    expect(ids(commandsFor("ACCOUNTANT"))).toContain("cash");
    expect(ids(commandsFor("PURCHASING"))).not.toContain("cash");
  });
});

describe("matchCommands", () => {
  const all = commandsFor("OWNER");

  it("الفارغ يُرجع القائمة كما هي", () => {
    expect(matchCommands("  ", all)).toEqual(all);
  });

  it("«كشف بنك» يجد الاستيراد قبل كلّ شيء — والكلمةُ بلا «ال» تلتقي بها", () => {
    expect(matchCommands("كشف بنك", all)[0].id).toBe("bank-import");
  });

  it("كلُّ كلمةٍ يجب أن تقع — «كشف بنك» لا يجد «طابِق كشف مورّد»", () => {
    expect(ids(matchCommands("كشف بنك", all))).not.toContain("statements");
  });

  it("الكلماتُ المرادفة تجد ما ليس في الاسم — «سداد» يجد دفعة الشهر", () => {
    expect(ids(matchCommands("سداد", all))).toContain("pay-run");
  });

  it("الهمزةُ والتاءُ المربوطة لا تمنعان — «اقفال» يجد «أقفل الشهر»", () => {
    expect(matchCommands("اقفال", all)[0].href).toBe("/close");
  });

  it("الإنجليزيّة تعمل لمن يكتب بها", () => {
    expect(matchCommands("Upload", all)[0].id).toBe("upload");
  });

  it("ما لا يطابق شيئاً يُرجع فراغاً — لا أقرب ما يكون", () => {
    expect(matchCommands("زززز", all)).toEqual([]);
  });

  it("المجموعتان لا تتناوبان — الأفعالُ كلُّها ثمّ الصفحات", () => {
    const groups = matchCommands("جرد", all).map((c) => c.group);
    const firstPage = groups.indexOf("PAGE");
    expect(firstPage).toBeGreaterThan(0);
    expect(groups.slice(firstPage).every((g) => g === "PAGE")).toBe(true);
  });
});
