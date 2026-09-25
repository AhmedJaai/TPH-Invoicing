import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AREAS,
  ACCOUNT_LINKS,
  MOBILE_TABS,
  activeArea,
  activeChild,
  canSeeArea,
  chordsFor,
  entryHref,
  groupedAreas,
  homeHref,
  mobileTabs,
  visibleAccountLinks,
  visibleAreas,
  visibleChildren,
} from "./nav";

describe("activeArea", () => {
  it("تطابق الجذر وحده ولا تبتلع سواه", () => {
    expect(activeArea("/")?.href).toBe("/");
    expect(activeArea("/bank")?.href).toBe("/bank");
  });

  it("تنسب الصفحة الفرعية إلى مساحتها", () => {
    expect(activeArea("/purchases/invoices")?.href).toBe("/suppliers");
    expect(activeArea("/money/expenses")?.href).toBe("/bank");
    expect(activeArea("/suppliers/Ganache")?.href).toBe("/suppliers");
  });

  /*
    ── الإصدار الثاني: كلُّ عملٍ يوميٍّ مدخلٌ باسمه ──

    كانت «المال» تجمع البنكَ والإقفالَ في بابٍ واحد، و«دفعة الشهر» لساناً
    تحت المورّدين — فيقرأ صاحبُ المقهى «عليك» ثمّ يبحث عن موضع الدفع.
    صار: المورّدون (لمن أدين) · الدفعات (ماذا أدفع ومتى) · البنك · الإقفال.
  */
  it("تنسب الصفحات إلى مساحاتها في نموذج الأعمال", () => {
    expect(activeArea("/statements")?.href).toBe("/suppliers");
    expect(activeArea("/analysis")?.href).toBe("/suppliers");
    expect(activeArea("/purchases")?.href).toBe("/suppliers");
    expect(activeArea("/payments")?.href).toBe("/payments");
    expect(activeArea("/cash")?.href).toBe("/payments");
    expect(activeArea("/money")?.href).toBe("/bank");
    expect(activeArea("/close")?.href).toBe("/close");
    expect(activeArea("/audit")?.href).toBe("/attention");
    expect(activeArea("/review")?.href).toBe("/attention");
    expect(activeArea("/upload")?.href).toBe("/documents");
    expect(activeArea("/documents/drive")?.href).toBe("/documents");
    expect(activeArea("/inventory")?.href).toBe("/inventory");
    expect(activeArea("/inventory/counts/abc")?.href).toBe("/inventory");
    expect(activeArea("/inventory/items/abc")?.href).toBe("/inventory");
    expect(activeArea("/inventory/trend")?.href).toBe("/inventory");
  });

  it("لا تخلط مساراً يشارك البادئة حرفياً دون أن يكون تحتها", () => {
    // `/bankrupt` ليست تحت `/bank` وإن بدأت بحروفها
    expect(activeArea("/bankrupt")).toBeUndefined();
  });

  it("تتجاهل الشرطة الأخيرة", () => {
    expect(activeArea("/bank/")?.href).toBe("/bank");
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
  it("المالك يرى المساحات الثماني كلّها", () => {
    expect(visibleAreas("OWNER")).toHaveLength(AREAS.length);
    expect(AREAS).toHaveLength(8);
  });

  it("مدير المشتريات لا يرى المال ولا ما يحتاج قراراً", () => {
    const hrefs = visibleAreas("PURCHASING").map((a) => a.href);
    expect(hrefs).not.toContain("/");
    expect(hrefs).not.toContain("/bank");
    expect(hrefs).not.toContain("/payments");
    expect(hrefs).not.toContain("/attention");
    expect(hrefs).toContain("/documents");
    /* ويعدّ الرفّ — فالميزانُ عملُه، وإن لم يرَ كلفةَ الفرق */
    expect(hrefs).toContain("/inventory");
  });

  it("المحاسب يرى البنك وما يحتاج قراراً والإقفال", () => {
    const hrefs = visibleAreas("ACCOUNTANT").map((a) => a.href);
    expect(hrefs).toContain("/bank");
    expect(hrefs).toContain("/attention");
    expect(hrefs).toContain("/close");
  });

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
    expect(visibleAccountLinks("PURCHASING").map((l) => l.href)).toEqual(["/settings"]);
  });

  /*
    ثماني مساحاتٍ في ثلاث مجموعات — والعددُ محروس: كلُّ مدخلٍ عملٌ
    يوميٌّ أو أسبوعيّ باسمه، لا جدولٌ في القاعدة.
  */
  it("المجموعات ثلاث بترتيبها، ولا مجموعةَ فارغة", () => {
    expect(groupedAreas("OWNER").map((g) => g.group)).toEqual(["today", "money", "ops"]);
    expect(groupedAreas("PURCHASING").map((g) => g.group)).toEqual(["today", "ops"]);
  });

  it("لكلّ مساحةٍ حرفُ اختصارٍ لا يتكرّر", () => {
    const chords = AREAS.map((a) => a.chord);
    expect(new Set(chords).size).toBe(chords.length);
    expect(chordsFor("OWNER")).toHaveLength(AREAS.length);
  });
});

describe("visibleChildren و entryHref", () => {
  it("تحجب اللسان الذي لا يملك الدور صلاحيته", () => {
    const payments = AREAS.find((a) => a.href === "/payments")!;
    // المحاسب لا يعتمد الدفعات — فلا يرى إلّا النقد القادم، ولسانٌ واحد ليس تفريعاً
    expect(visibleChildren("ACCOUNTANT", payments)).toEqual([]);
    // ومدخلُه إلى المساحة النقدُ القادم لا صفحةٌ تردّه
    expect(entryHref("ACCOUNTANT", payments)).toBe("/cash");
    expect(entryHref("OWNER", payments)).toBe("/payments");
  });

  it("لا تعرض شريط ألسنة لمساحة بلا ألسنة", () => {
    for (const href of ["/", "/attention", "/close"]) {
      const area = AREAS.find((a) => a.href === href)!;
      expect(visibleChildren("OWNER", area)).toEqual([]);
    }
  });

  /*
    الدرايف لسانٌ في «المستندات» لا قسمٌ أسفل «ارفع»: سأل صاحبُ المقهى «ما
    أشوفها، هل صارت تلقائيّة؟» والمزامنةُ تعمل وحدها بلا أثرٍ يُرى.
  */
  it("المستندات تُظهر الرفعَ والدرايفَ لساناً لمن يرفع", () => {
    const docs = AREAS.find((a) => a.href === "/documents")!;
    expect(visibleChildren("OWNER", docs).map((c) => c.href)).toEqual(["/documents", "/upload", "/documents/drive"]);
    expect(activeChild("/documents/drive", docs)?.href).toBe("/documents/drive");
    expect(activeChild("/documents", docs)?.href).toBe("/documents");
    expect(entryHref("OWNER", docs)).toBe("/documents");
  });
});

describe("mobileTabs", () => {
  it("ثلاث مساحات ثمّ الباقي في المزيد", () => {
    const { tabs, more } = mobileTabs("OWNER", "/");
    expect(tabs).toHaveLength(MOBILE_TABS);
    expect(tabs.length + more.length).toBe(AREAS.length);
  });

  it("لا تكرّر مساحةً بين الشريط والمزيد", () => {
    const { tabs, more } = mobileTabs("OWNER", "/bank");
    const all = [...tabs, ...more].map((a) => a.href);
    expect(new Set(all).size).toBe(all.length);
  });

  it("ترفع المساحة المفتوحة إلى الشريط كي لا يفقد المستخدم موضعه", () => {
    const { tabs } = mobileTabs("OWNER", "/bank");
    expect(tabs.map((a) => a.href)).toContain("/bank");
    expect(tabs).toHaveLength(MOBILE_TABS);
  });

  it("تبقي «اليوم» في الشريط حتى حين تُرفع مساحة بعيدة", () => {
    const { tabs } = mobileTabs("OWNER", "/inventory");
    expect(tabs[0].href).toBe("/");
  });

  it("لا ترفع شيئاً حين تكون المساحة المفتوحة في الشريط أصلاً", () => {
    const { tabs, more } = mobileTabs("OWNER", "/attention");
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
    expect(labels.get("/cash")).toBe("النقد القادم");
    expect(labels.get("/statements")).toBe("الكشوف");
    expect(labels.get("/bank")).toBe("حركة البنك");
    // الإقفالُ مساحةٌ بلا ألسنة — واسمُها عنوانُ صفحتها
    expect(AREAS.find((a) => a.href === "/close")?.label).toBe("إقفال الشهر");
    expect(labels.get("/inventory")).toBe("الجرد الحالي");
    expect(labels.get("/inventory/history")).toBe("سجلّ الجرد");
    /* والصفحةُ تحمل المبيعاتِ والكتالوجَ معاً، فاسمُها اسمُ الفعل لا أحدِ مفعوليه */
    expect(labels.get("/inventory/import")).toBe("الاستيراد");
    // الدرايف لسانٌ يُرى — لا قسمٌ أسفل «ارفع» يُظنّ غائباً
    expect(labels.get("/documents/drive")).toBe("الدرايف");
    expect(labels.get("/upload")).toBe("ارفع مستنداً");
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

/*
  اسمُ الهيكل هو اسمُ صفحته.

  كان `/attention` يعرض «ما يحتاج انتباهك» ريثما تُبنى، ثمّ «يحتاج
  قرارك» حين تُبنى — وكذلك `/statements` («كشوف المورّدين» ثمّ
  «الكشوف») و`/money` («المال» ثمّ «أين ذهب المال») وستٌّ غيرها.
  فيقرأ صاحب المقهى عنواناً ثمّ يراه يتبدّل أمامه، فيشكّ أنّه انتقل.
*/
describe("الهيكل يحمل اسم صفحته", () => {
  /*
    عنوانُ الصفحة هو خاصّيّةُ `PageShell` أو `PageSkeleton` — لا أوّلُ
    `title="` في الملفّ: كان يلتقط عنوانَ قسمٍ («ما نعرفه مقابل ما يقوله
    كشفه») في ملفّ المورّد وعنوانُ الصفحة فيه محسوبٌ من اسمه.
  */
  const titleOf = (file: string): string | null => {
    if (!existsSync(file)) return null;
    const m = readFileSync(file, "utf8").match(/<(?:PageShell|PageSkeleton)\b[\s\S]*?\btitle=(?:"([^"]+)"|\{)/);
    return m?.[1] ?? null;
  };

  const loadings: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const f = join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.name === "loading.tsx") loadings.push(f);
    }
  };
  walk("src/app");

  it("ثمّة هياكل تُفحَص أصلاً", () => {
    expect(loadings.length).toBeGreaterThan(10);
  });

  for (const l of loadings) {
    const page = l.replace(/loading\.tsx$/, "page.tsx");
    const pageTitle = titleOf(page);
    /* صفحةٌ بلا عنوانٍ حرفيّ (تحويلٌ أو عنوانٌ محسوب) لا تُقارَن */
    if (!pageTitle) continue;
    it(`${l} يطابق عنوان صفحته`, () => {
      expect(titleOf(l)).toBe(pageTitle);
    });
  }
});

/*
  لا رابطَ ظاهرٌ لدورٍ يفتح عليه «خارج صلاحيتك» — وجده الزاحفُ بدور مدير
  المشتريات: العلامةُ إلى «اليوم» (يُحوِّل)، وألسنةُ المورّدين إلى صفحاتٍ مالُها
  خارج صلاحيته.
*/
describe("روابطُ الدور تصل ولا تُردّ", () => {
  it("العلامةُ تفتح أوّلَ ما يراه الدور", () => {
    expect(homeHref("OWNER")).toBe("/");
    expect(homeHref("PURCHASING")).toBe("/documents");
  });

  it("فتاتُ الموضع لا يفتح مساحةً خارج الصلاحية", () => {
    const payments = AREAS.find((a) => a.href === "/payments")!;
    expect(canSeeArea("OWNER", payments)).toBe(true);
    expect(canSeeArea("PURCHASING", payments)).toBe(false);
  });

  it("ألسنةُ المورّدين التي صفحاتُها مالٌ تحتاج رؤيةَ المال", () => {
    const suppliers = AREAS.find((a) => a.href === "/suppliers")!;
    for (const href of ["/purchases/invoices", "/statements", "/analysis"]) {
      expect(suppliers.children.find((c) => c.href === href)?.needs).toBe("amounts:view");
    }
  });
});
