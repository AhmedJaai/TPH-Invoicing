import { describe, expect, it } from "vitest";
import { decodeBase64Strict, parseZatcaQrText, parseZatcaTlvBytes } from "./zatca-tlv";

/** يبني TLV من أزواج (وسم، قيمة) — القيمة نصٌّ أو بايتات. */
function tlv(pairs: [number, string | Uint8Array][]): Buffer {
  const chunks: Buffer[] = [];
  for (const [tag, value] of pairs) {
    const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
    chunks.push(Buffer.from([tag, bytes.length]), bytes);
  }
  return Buffer.concat(chunks);
}

const PHASE1: [number, string][] = [
  [1, "مؤسسة أوراق الزيتون التجارية"],
  [2, "310122393500003"],
  [3, "2026-09-13T15:13:00Z"],
  [4, "1150.00"],
  [5, "150.00"],
];

describe("parseZatcaQrText — رمز المرحلة الأولى", () => {
  it("يقرأ الحقول الخمسة، والاسم العربيّ متعدّد البايتات بطوله بالبايتات لا بالحروف", () => {
    const r = parseZatcaQrText(tlv(PHASE1).toString("base64"));
    expect(r).toEqual({
      ok: true,
      facts: {
        sellerName: "مؤسسة أوراق الزيتون التجارية",
        sellerVatNumber: "310122393500003",
        sellerVatRaw: "310122393500003",
        timestampRaw: "2026-09-13T15:13:00Z",
        date: "2026-09-13",
        totalMinor: 115000,
        vatMinor: 15000,
        phase2: false,
        tags: [1, 2, 3, 4, 5],
      },
    });
  });

  it("المثال المنشور في دليل الهيئة يُقرأ كما هو", () => {
    /* Bobs Records · 310122393500003 · 2022-04-25T15:30:00Z · 1000.00 · 150.00 */
    const sample =
      "AQxCb2JzIFJlY29yZHMCDzMxMDEyMjM5MzUwMDAwMwMUMjAyMi0wNC0yNVQxNTozMDowMFoEBzEwMDAuMDAFBjE1MC4wMA==";
    const r = parseZatcaQrText(sample);
    expect(r.ok && r.facts).toMatchObject({
      sellerName: "Bobs Records",
      sellerVatNumber: "310122393500003",
      date: "2022-04-25",
      totalMinor: 100000,
      vatMinor: 15000,
    });
  });

  it("يقبل base64 بلا حشوٍ وبأبجديّة الروابط وبفراغاتٍ داخله", () => {
    const b64 = tlv(PHASE1).toString("base64");
    const messy = b64.replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_").replace(/(.{20})/g, "$1\n ");
    const r = parseZatcaQrText(messy);
    expect(r.ok && r.facts.totalMinor).toBe(115000);
  });

  it("اسمٌ طوله ٢٠٠ بايت (فوق ١٢٧) يُقرأ بطوله ببايتٍ واحد", () => {
    const name = "م".repeat(100); // ٢٠٠ بايت
    const r = parseZatcaTlvBytes(tlv([[1, name], ...PHASE1.slice(1)]));
    expect(r.ok && r.facts.sellerName).toBe(name);
  });
});

describe("parseZatcaQrText — الوقت واليوم بتوقيت الرياض", () => {
  const at = (ts: string) => {
    const r = parseZatcaTlvBytes(tlv([PHASE1[0], PHASE1[1], [3, ts], PHASE1[3], PHASE1[4]]));
    return r.ok ? r.facts.date : "FAILED";
  };

  it("آخر الليل بـUTC هو اليوم التالي في الرياض — وقد يكون شهراً ضريبيّاً آخر", () => {
    expect(at("2026-09-30T21:30:00Z")).toBe("2026-10-01");
    expect(at("2026-09-30T20:59:59Z")).toBe("2026-09-30");
  });

  it("الوقت بإزاحةٍ صريحة يُحوَّل، وبلا منطقةٍ يُؤخَذ يومُه كما كُتب", () => {
    expect(at("2026-10-01T00:30:00+03:00")).toBe("2026-10-01");
    expect(at("2026-10-01T02:00:00+0530")).toBe("2026-09-30");
    expect(at("2026-09-30T23:50:00")).toBe("2026-09-30");
    expect(at("2026-09-30 23:50:00")).toBe("2026-09-30");
    expect(at("2026-09-30")).toBe("2026-09-30");
  });

  it("وقتٌ لا يُفهَم يُبقي اليوم مجهولاً ولا يُسقط بقيّة الحقول", () => {
    const r = parseZatcaTlvBytes(tlv([PHASE1[0], PHASE1[1], [3, "أمس"], PHASE1[3], PHASE1[4]]));
    expect(r.ok && r.facts.date).toBeNull();
    expect(r.ok && r.facts.totalMinor).toBe(115000);
    expect(at("2026-13-45T10:00:00Z")).toBeNull();
  });
});

describe("parseZatcaQrText — المجهول ليس صفراً", () => {
  const withAmounts = (total: string, vat: string) =>
    parseZatcaTlvBytes(tlv([PHASE1[0], PHASE1[1], PHASE1[2], [4, total], [5, vat]]));

  it("مبلغٌ فارغ أو لا يُقرأ يعود null لا صفراً", () => {
    const r = withAmounts("", "abc");
    expect(r.ok && r.facts.totalMinor).toBeNull();
    expect(r.ok && r.facts.vatMinor).toBeNull();
  });

  it("الصفر المكتوب صفرٌ حقيقيّ: فاتورةٌ بلا ضريبة", () => {
    const r = withAmounts("260.00", "0.00");
    expect(r.ok && r.facts.vatMinor).toBe(0);
    expect(r.ok && r.facts.totalMinor).toBe(26000);
  });

  it("المبلغ بلا كسرٍ أو بمنزلةٍ واحدة أو بأرقامٍ عربيّة يُقرأ بالهللات تماماً", () => {
    expect((withAmounts("115", "15.5") as { facts: { totalMinor: number; vatMinor: number } }).facts)
      .toMatchObject({ totalMinor: 11500, vatMinor: 1550 });
    const r = withAmounts("١١٥٫٠٠", "١٥٫٠٠");
    expect(r.ok && r.facts.totalMinor).toBe(11500);
  });

  it("ثلاث منازل ليست أصفاراً لا تُقرَّب — تُعلَن مجهولة", () => {
    const r = withAmounts("115.005", "15.00");
    expect(r.ok && r.facts.totalMinor).toBeNull();
  });

  it("رقمٌ ضريبيّ ليس ١٥ رقماً يبدأ وينتهي بـ٣ يعود null والخامّ محفوظ", () => {
    const r = parseZatcaTlvBytes(tlv([PHASE1[0], [2, "31012239350000"], ...PHASE1.slice(2)]));
    expect(r.ok && r.facts.sellerVatNumber).toBeNull();
    expect(r.ok && r.facts.sellerVatRaw).toBe("31012239350000");
  });

  it("اسمٌ فارغ يعود null", () => {
    const r = parseZatcaTlvBytes(tlv([[1, ""], ...PHASE1.slice(1)]));
    expect(r.ok && r.facts.sellerName).toBeNull();
  });
});

describe("parseZatcaQrText — المرحلة الثانية", () => {
  it("وسوم البصمة والتوقيع والمفتاح (بايتات خام) تُعدّ ولا تُفسد القراءة", () => {
    const binary = new Uint8Array(88).map((_, i) => (i * 37 + 200) % 256); // ليست UTF-8
    const r = parseZatcaTlvBytes(
      tlv([...PHASE1, [6, "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzk="], [7, "MEUCIQD"], [8, binary], [9, binary.subarray(0, 70)]]),
    );
    expect(r.ok && r.facts).toMatchObject({
      phase2: true,
      tags: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      totalMinor: 115000,
      vatMinor: 15000,
    });
  });
});

describe("parseZatcaQrText — ما ليس رمز فاتورة", () => {
  it("رابط موقعٍ أو نصٌّ حرّ ليس base64", () => {
    expect(parseZatcaQrText("https://example.com/menu?id=7")).toMatchObject({ ok: false });
    expect(parseZatcaQrText("فاتورة رقم ١٢")).toMatchObject({ ok: false });
    expect(parseZatcaQrText("")).toMatchObject({ ok: false });
    expect(parseZatcaQrText(null)).toMatchObject({ ok: false });
  });

  it("base64 سليمٌ لغير TLV يُردّ ولا يُخمَّن منه مبلغ", () => {
    expect(parseZatcaQrText(Buffer.from("hello world, this is not tlv").toString("base64"))).toMatchObject({ ok: false });
    expect(parseZatcaQrText(Buffer.from("WIFI:S:TPH;T:WPA;P:x;;").toString("base64"))).toMatchObject({ ok: false });
  });

  it("رمزٌ مقطوع: القيمة أقصر من طولها المعلَن", () => {
    const whole = tlv(PHASE1);
    const r = parseZatcaTlvBytes(whole.subarray(0, whole.length - 3));
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.reason).toContain("مقطوع");
  });

  it("وسمٌ بلا بايت طول في آخر السلسلة", () => {
    expect(parseZatcaTlvBytes(Buffer.concat([tlv(PHASE1), Buffer.from([6])]))).toMatchObject({ ok: false });
  });

  it("وسمٌ ناقص من الخمسة", () => {
    const r = parseZatcaTlvBytes(tlv(PHASE1.slice(0, 4)));
    expect(!r.ok && r.reason).toContain("5");
  });

  it("وسمٌ مكرَّر أو صفريّ", () => {
    expect(parseZatcaTlvBytes(tlv([...PHASE1, [4, "999.00"]]))).toMatchObject({ ok: false });
    expect(parseZatcaTlvBytes(tlv([[0, "x"], ...PHASE1]))).toMatchObject({ ok: false });
  });

  it("بايتات ليست UTF-8 في حقلٍ نصّيّ", () => {
    const r = parseZatcaTlvBytes(tlv([[1, new Uint8Array([0xff, 0xfe, 0xc3])], ...PHASE1.slice(1)]));
    expect(r).toMatchObject({ ok: false });
  });

  it("سلسلةٌ فارغة", () => {
    expect(parseZatcaTlvBytes(new Uint8Array())).toMatchObject({ ok: false });
  });
});

describe("decodeBase64Strict", () => {
  it("يردّ ما فيه محرفٌ خارج الأبجديّة ولا يُسقطه صامتاً", () => {
    expect(decodeBase64Strict("AQxCb2Jz*IFJlY29yZHM=")).toBeNull();
    expect(decodeBase64Strict("AQxCb")).toBeNull();
  });
});
