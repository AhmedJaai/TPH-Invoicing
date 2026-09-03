import { describe, expect, it } from "vitest";
import { KNOWN_SLUGS, normalizeName, SUPPLIER_SEED } from "./suppliers-seed";

describe("سجل الموردين الابتدائي", () => {
  it("الأسماء المختصرة فريدة", () => {
    expect(new Set(KNOWN_SLUGS).size).toBe(KNOWN_SLUGS.length);
  });

  it("أسماء المجلدات فريدة", () => {
    const folders = SUPPLIER_SEED.map((s) => s.driveFolderName.trim());
    // صيغ الأسماء المكرّرة مقصودة لتغطية اختلاف التسمية في الأرشيف
    const duplicates = folders.filter((f, i) => folders.indexOf(f) !== i);
    expect(duplicates.every((f) => ["Hungry Man Bakery", "Ganache (AGK)"].includes(f))).toBe(true);
  });

  it("لكل مورد اسم عربي وتصنيف", () => {
    for (const s of SUPPLIER_SEED) {
      expect(s.nameAr.length, s.slug).toBeGreaterThan(0);
      expect(s.category, s.slug).toBeTruthy();
    }
  });

  it("الموردون بلا فواتير موسومون ومعلَّلون", () => {
    const without = SUPPLIER_SEED.filter((s) => s.issuesInvoices === false);
    expect(without.map((s) => s.slug).sort()).toEqual(["Mariah", "PURE-Oska", "WaterFilters"]);
    for (const s of without) expect(s.notes, s.slug).toBeTruthy();
  });

  it("الاسم المختصر بلا مسافات", () => {
    for (const s of SUPPLIER_SEED) expect(s.slug, s.slug).not.toMatch(/\s/);
  });
});

describe("تطبيع الأسماء للمطابقة", () => {
  it("يوحّد صور الهمزة", () => {
    expect(normalizeName("أوراق")).toBe(normalizeName("اوراق"));
    expect(normalizeName("إبراهيم")).toBe(normalizeName("ابراهيم"));
    expect(normalizeName("آل سعود")).toBe(normalizeName("ال سعود"));
  });

  it("يوحّد التاء المربوطة والألف المقصورة", () => {
    expect(normalizeName("مؤسسة")).toBe(normalizeName("مؤسسه"));
    expect(normalizeName("مصطفى")).toBe(normalizeName("مصطفي"));
  });

  it("يتجاهل حالة الأحرف والرموز والمسافات الزائدة", () => {
    expect(normalizeName("KHALID SAED BN MAHFUS TRADING"))
      .toBe(normalizeName("  khalid  saed-bn/mahfus   trading "));
  });

  it("يفرّق بين اسمين مختلفين فعلاً", () => {
    expect(normalizeName("سرد للتجارة")).not.toBe(normalizeName("سرد كو"));
  });
});
