import { describe, expect, it } from "vitest";
import {
  AREAS,
  ACCOUNT_LINKS,
  MOBILE_TABS,
  activeArea,
  activeChild,
  mobileTabs,
  visibleAccountLinks,
  visibleAreas,
  visibleChildren,
} from "./nav";

describe("activeArea", () => {
  it("تطابق الجذر وحده ولا تبتلع سواه", () => {
    expect(activeArea("/")?.href).toBe("/");
    expect(activeArea("/money")?.href).toBe("/money");
  });

  it("تنسب الصفحة الفرعية إلى مساحتها", () => {
    expect(activeArea("/purchases/invoices")?.href).toBe("/suppliers");
    expect(activeArea("/money/expenses")?.href).toBe("/money");
    expect(activeArea("/suppliers/Ganache")?.href).toBe("/suppliers");
  });

  it("تنسب الصفحات إلى مساحاتها بعد دمج «المشتريات» في «المورّدون»", () => {
    expect(activeArea("/statements")?.href).toBe("/suppliers");
    expect(activeArea("/analysis")?.href).toBe("/suppliers");
    expect(activeArea("/purchases")?.href).toBe("/suppliers");
    expect(activeArea("/bank")?.href).toBe("/money");
    expect(activeArea("/payments")?.href).toBe("/money");
    expect(activeArea("/close")?.href).toBe("/money");
    expect(activeArea("/audit")?.href).toBe("/attention");
    expect(activeArea("/review")?.href).toBe("/attention");
    expect(activeArea("/upload")?.href).toBe("/documents");
  });

  it("لا تخلط مساراً يشارك البادئة حرفياً دون أن يكون تحتها", () => {
    // `/moneybox` ليست تحت `/money` وإن بدأت بحروفها
    expect(activeArea("/moneybox")).toBeUndefined();
  });

  it("تتجاهل الشرطة الأخيرة", () => {
    expect(activeArea("/money/")?.href).toBe("/money");
  });

  it("ترجع غير معرَّف لمسار لا يخصّ أحداً", () => {
    expect(activeArea("/login")).toBeUndefined();
  });
});

describe("activeChild", () => {
  const suppliers = AREAS.find((a) => a.href === "/suppliers")!;

  it("تختار أطول بادئة لا أوّل تطابق", () => {
    expect(activeChild("/purchases/invoices", suppliers)?.href).toBe("/purchases/invoices");
    expect(activeChild("/suppliers", suppliers)?.href).toBe("/suppliers");
    // صفحةُ مورّدٍ بعينه تبقى تحت لسان «الحسابات»
    expect(activeChild("/suppliers/Ganache", suppliers)?.href).toBe("/suppliers");
  });

  it("ترجع غير معرَّف لقسم خارج المساحة", () => {
    expect(activeChild("/bank", suppliers)).toBeUndefined();
  });
});

describe("visibleAreas", () => {
  it("المالك يرى الخمس كلّها", () => {
    expect(visibleAreas("OWNER")).toHaveLength(AREAS.length);
    expect(AREAS).toHaveLength(5);
  });

  it("مدير المشتريات لا يرى المال ولا ما يحتاج قراراً", () => {
    const hrefs = visibleAreas("PURCHASING").map((a) => a.href);
    expect(hrefs).not.toContain("/money");
    expect(hrefs).not.toContain("/attention");
    expect(hrefs).toContain("/documents");
  });

  it("المحاسب يرى المال وما يحتاج قراراً", () => {
    const hrefs = visibleAreas("ACCOUNTANT").map((a) => a.href);
    expect(hrefs).toContain("/money");
    expect(hrefs).toContain("/attention");
  });

  /*
    ── ما خرج من التنقّل عمداً ──

    كانت ستَّ مساحاتٍ وسبعةَ عشر رابطاً في شريطٍ من صفّين. وثلاثٌ من
    تلك الوجهات لم تكن وجهاتٍ أصلاً: «الإعدادات» تُضبَط مرّةً في العمر،
    و«الأداء» و«المشتريات» تكرّران ما في غيرهما.
  */
  it("لا مساحةَ لما يُضبط مرّةً في العمر ولا لصفحةٍ حُذفت", () => {
    const hrefs = AREAS.map((a) => a.href);
    expect(hrefs).not.toContain("/settings");
    expect(hrefs).not.toContain("/performance");
    expect(hrefs).not.toContain("/purchases");
    expect(hrefs).not.toContain("/review");
  });

  it("الإعدادات وسجلّ التدقيق في روابط الحساب لا في المساحات", () => {
    const hrefs = visibleAccountLinks("OWNER").map((l) => l.href);
    expect(hrefs).toEqual(["/settings", "/settings/audit"]);
    // ومدير المشتريات لا يرى سجلّ التدقيق
    expect(visibleAccountLinks("PURCHASING").map((l) => l.href)).toEqual(["/settings"]);
  });

  it("عددُ روابط التنقّل الظاهرة خمسة — كان سبعةَ عشر", () => {
    const owner = visibleAreas("OWNER");
    expect(owner).toHaveLength(5);
  });
});

describe("visibleChildren", () => {
  it("تحجب اللسان الذي لا يملك الدور صلاحيته", () => {
    const money = AREAS.find((a) => a.href === "/money")!;
    const forAccountant = visibleChildren("ACCOUNTANT", money).map((c) => c.href);
    // المحاسب لا يعتمد الدفعات
    expect(forAccountant).not.toContain("/payments");
    // لكنّه يقفل الشهر
    expect(forAccountant).toContain("/close");
  });

  it("لا تعرض شريط ألسنة لمساحة بلسانٍ واحد أو بلا ألسنة", () => {
    const home = AREAS.find((a) => a.href === "/")!;
    expect(visibleChildren("OWNER", home)).toEqual([]);

    // «المستندات» صارت وجهةً واحدة — والرفع فعلٌ لا لسان
    const documents = AREAS.find((a) => a.href === "/documents")!;
    expect(visibleChildren("OWNER", documents)).toEqual([]);

    // و«يحتاج قرارك» مكانٌ واحد للعمل كلّه
    const attention = AREAS.find((a) => a.href === "/attention")!;
    expect(visibleChildren("OWNER", attention)).toEqual([]);
  });
});

describe("mobileTabs", () => {
  it("أربع مساحات ثمّ الباقي في المزيد", () => {
    const { tabs, more } = mobileTabs("OWNER", "/");
    expect(tabs).toHaveLength(MOBILE_TABS);
    expect(tabs.length + more.length).toBe(AREAS.length);
  });

  it("لا تكرّر مساحةً بين الشريط والمزيد", () => {
    const { tabs, more } = mobileTabs("OWNER", "/documents");
    const all = [...tabs, ...more].map((a) => a.href);
    expect(new Set(all).size).toBe(all.length);
  });

  it("ترفع المساحة المفتوحة إلى الشريط كي لا يفقد المستخدم موضعه", () => {
    const { tabs } = mobileTabs("OWNER", "/documents");
    expect(tabs.map((a) => a.href)).toContain("/documents");
    expect(tabs).toHaveLength(MOBILE_TABS);
  });

  it("تبقي الرئيسية في الشريط حتى حين تُرفع مساحة بعيدة", () => {
    const { tabs } = mobileTabs("OWNER", "/documents");
    expect(tabs[0].href).toBe("/");
  });

  it("لا ترفع شيئاً حين تكون المساحة المفتوحة في الشريط أصلاً", () => {
    const { tabs, more } = mobileTabs("OWNER", "/money");
    expect(tabs).toEqual(visibleAreas("OWNER").slice(0, MOBILE_TABS));
    expect(more).toEqual(visibleAreas("OWNER").slice(MOBILE_TABS));
  });

  it("لا تنكسر حين تكون المساحات أقلّ من طول الشريط", () => {
    const { tabs, more } = mobileTabs("PURCHASING", "/upload");
    expect(more).toEqual([]);
    expect(tabs.length).toBeLessThanOrEqual(MOBILE_TABS);
    expect(tabs.map((a) => a.href)).toContain("/documents");
  });
});

describe("«كم أدين ولمن؟»", () => {
  const suppliers = AREAS.find((a) => a.href === "/suppliers")!;

  it("أوّل ألسنة المورّدين يفتح الجدول بالمورّد لا بالفاتورة", () => {
    expect(suppliers.children[0]).toMatchObject({
      href: "/suppliers",
      label: "الحسابات",
    });
  });

  it("لا مرشِّح في مسار لسان — اللسان وجهةٌ لا ترشيح", () => {
    // كان «المستحقّ عليك» يفتح `?paid=OPEN`: فواتيرُ مورّدٍ دُفع له
    // مقدَّماً تظهر فيه «مستحقّة»، وهي مسدَّدة.
    for (const area of AREAS) {
      for (const child of area.children) {
        expect(child.href).not.toContain("?");
      }
    }
  });
});

describe("سلامة البنية", () => {
  it("لا مسار مملوك لمساحتين", () => {
    const seen = new Map<string, string>();
    for (const area of AREAS) {
      for (const base of [area.href, ...area.owns]) {
        expect(seen.has(base)).toBe(false);
        seen.set(base, area.href);
      }
    }
  });

  it("اسم اللسان هو عنوان صفحته", () => {
    // الأسماء التي اختلفت عن عناوين صفحاتها فأرسلت صاحب العمل إلى غير
    // ما طلب — «كشف الحساب» أخطرُها: في البنوك السعوديّة تعني حركاته.
    const labels = new Map(AREAS.flatMap((a) => a.children.map((c) => [c.href, c.label] as const)));
    expect(labels.get("/payments")).toBe("دفعة الشهر");
    expect(labels.get("/statements")).toBe("الكشوف");
    expect(labels.get("/bank")).toBe("حركة البنك");
    expect(labels.get("/analysis")).toBe("الأصناف والأسعار");
    // ولا لسان يحمل اسم «التدفّق وقائمة الدخل» — صار التدفّق في «المال»
    expect([...labels.values()]).not.toContain("التدفّق وقائمة الدخل");
  });

  it("كل لسان يقع تحت مساحته", () => {
    for (const area of AREAS) {
      for (const child of area.children) {
        expect(activeArea(child.href)?.href).toBe(area.href);
      }
    }
  });

  it("كل رابط حساب له صلاحيته", () => {
    for (const link of ACCOUNT_LINKS) expect(link.needs).toBeDefined();
  });
});
