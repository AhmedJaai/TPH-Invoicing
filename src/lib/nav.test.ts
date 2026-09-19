import { describe, expect, it } from "vitest";
import {
  AREAS,
  MOBILE_TABS,
  activeArea,
  activeChild,
  mobileTabs,
  visibleAreas,
  visibleChildren,
} from "./nav";

describe("activeArea", () => {
  it("تطابق الجذر وحده ولا تبتلع سواه", () => {
    expect(activeArea("/")?.href).toBe("/");
    expect(activeArea("/money")?.href).toBe("/money");
  });

  it("تنسب الصفحة الفرعية إلى مساحتها", () => {
    expect(activeArea("/purchases/products")?.href).toBe("/purchases");
    expect(activeArea("/money/statement")?.href).toBe("/money");
    expect(activeArea("/settings/audit")?.href).toBe("/settings");
  });

  it("تنسب الصفحات القديمة إلى مساحاتها الجديدة", () => {
    expect(activeArea("/suppliers")?.href).toBe("/purchases");
    expect(activeArea("/statements")?.href).toBe("/purchases");
    expect(activeArea("/analysis")?.href).toBe("/purchases");
    expect(activeArea("/bank")?.href).toBe("/money");
    expect(activeArea("/payments")?.href).toBe("/money");
    expect(activeArea("/close")?.href).toBe("/money");
    expect(activeArea("/audit")?.href).toBe("/attention");
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
  const purchases = AREAS.find((a) => a.href === "/purchases")!;

  it("تختار أطول بادئة لا أوّل تطابق", () => {
    // `/purchases` و`/purchases/products` كلاهما يطابق — والأطول أصدق
    expect(activeChild("/purchases/products", purchases)?.href).toBe("/purchases/products");
    expect(activeChild("/purchases", purchases)?.href).toBe("/purchases");
  });

  it("ترجع غير معرَّف لقسم خارج المساحة", () => {
    expect(activeChild("/bank", purchases)).toBeUndefined();
  });
});

describe("visibleAreas", () => {
  it("المالك يرى الستّ كلّها", () => {
    expect(visibleAreas("OWNER")).toHaveLength(AREAS.length);
  });

  it("مدير المشتريات لا يرى المال ولا ما يحتاج انتباهك", () => {
    const hrefs = visibleAreas("PURCHASING").map((a) => a.href);
    expect(hrefs).not.toContain("/money");
    expect(hrefs).not.toContain("/attention");
    expect(hrefs).toContain("/documents");
  });

  it("«الأداء» لم تعد مساحةً — صارت قسم «الأسعار» تحت المشتريات", () => {
    // ثلاث مساحاتٍ بأسماء متقاربة عن شيءٍ واحد: الأصناف وأسعارها
    expect(AREAS.map((a) => a.href)).not.toContain("/performance");
    const purchases = AREAS.find((a) => a.href === "/purchases")!;
    expect(purchases.children.find((c) => c.href === "/performance")?.label).toBe("الأسعار");
    expect(activeArea("/performance")?.href).toBe("/purchases");
  });

  it("المحاسب يرى المال ولا يرى شيئاً يحتاج صلاحية ليست له", () => {
    const hrefs = visibleAreas("ACCOUNTANT").map((a) => a.href);
    expect(hrefs).toContain("/money");
    expect(hrefs).toContain("/attention");
  });
});

describe("visibleChildren", () => {
  it("تحجب القسم الذي لا يملك الدور صلاحيته", () => {
    const money = AREAS.find((a) => a.href === "/money")!;
    const forAccountant = visibleChildren("ACCOUNTANT", money).map((c) => c.href);
    // المحاسب لا يعتمد الدفعات
    expect(forAccountant).not.toContain("/payments");
    // لكنّه يقفل الشهر
    expect(forAccountant).toContain("/close");
  });

  it("لا تعرض شريط أقسام لمساحة بقسم واحد أو بلا أقسام", () => {
    const home = AREAS.find((a) => a.href === "/")!;
    expect(visibleChildren("OWNER", home)).toEqual([]);

    const documents = AREAS.find((a) => a.href === "/documents")!;
    // مدير المشتريات يرى الرفع والأرشيف كليهما
    expect(visibleChildren("PURCHASING", documents)).toHaveLength(2);
  });
});

describe("mobileTabs", () => {
  it("أربع مساحات ثمّ الباقي في المزيد", () => {
    const { tabs, more } = mobileTabs("OWNER", "/");
    expect(tabs).toHaveLength(MOBILE_TABS);
    expect(tabs.length + more.length).toBe(AREAS.length);
  });

  it("لا تكرّر مساحةً بين الشريط والمزيد", () => {
    const { tabs, more } = mobileTabs("OWNER", "/settings");
    const all = [...tabs, ...more].map((a) => a.href);
    expect(new Set(all).size).toBe(all.length);
  });

  it("ترفع المساحة المفتوحة إلى الشريط كي لا يفقد المستخدم موضعه", () => {
    const { tabs } = mobileTabs("OWNER", "/settings/audit");
    expect(tabs.map((a) => a.href)).toContain("/settings");
    expect(tabs).toHaveLength(MOBILE_TABS);
  });

  it("تبقي الرئيسية في الشريط حتى حين تُرفع مساحة بعيدة", () => {
    const { tabs } = mobileTabs("OWNER", "/settings");
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
  const purchases = AREAS.find((a) => a.href === "/purchases")!;

  it("أوّل أقسام المشتريات يفتح الجدول بالمورّد", () => {
    expect(purchases.children[0]).toMatchObject({
      href: "/purchases/insights",
      label: "عليك لكلّ مورّد",
    });
  });

  it("لا مرشِّح في مسار قسم — القسم وجهةٌ لا ترشيح", () => {
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

  it("اسم القسم هو عنوان صفحته", () => {
    // الأسماء التي اختلفت عن عناوين صفحاتها فأرسلت صاحب العمل إلى غير
    // ما طلب — «كشف الحساب» أخطرُها: في البنوك السعوديّة تعني حركاته.
    const money = AREAS.find((a) => a.href === "/money")!;
    const documents = AREAS.find((a) => a.href === "/documents")!;
    const purchases = AREAS.find((a) => a.href === "/purchases")!;
    const labels = new Map(
      [...money.children, ...documents.children, ...purchases.children].map((c) => [c.href, c.label]),
    );
    expect(labels.get("/money/statement")).toBe("التدفّق وقائمة الدخل");
    expect(labels.get("/payments")).toBe("دفعة الشهر");
    expect(labels.get("/statements")).toBe("كشوف المورّدين");
    expect(labels.get("/documents")).toBe("المستندات");
    expect(labels.get("/upload")).toBe("ارفع مستنداً");
  });

  it("كل قسم يقع تحت مساحته", () => {
    for (const area of AREAS) {
      for (const child of area.children) {
        expect(activeArea(child.href)?.href).toBe(area.href);
      }
    }
  });
});
