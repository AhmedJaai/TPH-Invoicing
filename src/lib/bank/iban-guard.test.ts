import { describe, expect, it } from "vitest";
import {
  findFirstTransfers, findIbanAlerts, firstTransferKey, groupIban, ibanAlertKey, payeeIbans, sharedIbans, type GuardTransfer, type LedgerTransfer,
} from "./iban-guard";

const A = "SA0380000000608010167519";
const B = "SA4420000001234567891234";
const C = "SA5610000000000000000099";
const OWN = "SA1180000000000000000001";
const own = new Set([OWN]);

const tx = (id: string, day: string, iban: string | null, amountMinor = 100_00, supplierId = "s1"): GuardTransfer => ({
  id, supplierId, day, amountMinor,
  text: iban ? `حوالة صادرة الى ${iban} من ${OWN}` : "حوالة صادرة بلا حساب",
});

describe("حارس تغيّر الآيبان", () => {
  it("حوالةٌ بعد كتابة الآيبان إلى غيره تُنبَّه بالآيبانين والمبلغ", () => {
    const alerts = findIbanAlerts(
      [{ id: "s1", savedIban: A, savedOn: "2026-09-01" }],
      [tx("t1", "2026-09-10", A), tx("t2", "2026-09-20", B, 2_500_00)],
      own, "2026-07-01",
    );
    expect(alerts).toEqual([{
      supplierId: "s1", kind: "DIFFERS_FROM_SAVED", seenIban: B, knownIbans: [A],
      transfers: [{ id: "t2", day: "2026-09-20", amountMinor: 2_500_00 }], totalMinor: 2_500_00,
    }]);
  });

  it("ما حُوِّل قبل كتابة الآيبان تاريخٌ لا مخالفة", () => {
    const alerts = findIbanAlerts(
      [{ id: "s1", savedIban: A, savedOn: "2026-09-01" }],
      [tx("t1", "2026-08-10", B), tx("t2", "2026-09-10", A)],
      own, "2026-07-01",
    );
    expect(alerts).toEqual([]);
  });

  it("يومُ الكتابة المجهول لا يُعفي حوالةً", () => {
    const alerts = findIbanAlerts([{ id: "s1", savedIban: A, savedOn: null }], [tx("t1", "2026-08-10", B)], own, "2026-07-01");
    expect(alerts).toHaveLength(1);
  });

  it("حوالاتٌ متتالية إلى الحساب المخالف سؤالٌ واحد بمجموعها", () => {
    const [a] = findIbanAlerts(
      [{ id: "s1", savedIban: A, savedOn: "2026-01-01" }],
      [tx("t1", "2026-09-10", B, 100_00), tx("t2", "2026-09-20", B, 250_00)],
      own, "2026-07-01",
    );
    expect(a.transfers.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(a.totalMinor).toBe(350_00);
  });

  it("بلا آيبانٍ مكتوب: حسابٌ جديد بعد حوالتين إلى غيره يُسأل عنه مرّةً", () => {
    const alerts = findIbanAlerts(
      [{ id: "s1", savedIban: null, savedOn: null }],
      [tx("t1", "2026-06-01", A), tx("t2", "2026-07-01", A), tx("t3", "2026-09-01", B), tx("t4", "2026-09-15", B)],
      own, "2026-07-01",
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: "NEW_ACCOUNT", seenIban: B, knownIbans: [A] });
    expect(alerts[0].transfers.map((t) => t.id)).toEqual(["t3", "t4"]);
  });

  it("حوالةٌ واحدة سابقة لا تصنع «حساباً معروفاً» — لا سؤالَ على ظنّ", () => {
    const alerts = findIbanAlerts(
      [{ id: "s1", savedIban: null, savedOn: null }],
      [tx("t1", "2026-06-01", A), tx("t2", "2026-09-01", B)],
      own, "2026-07-01",
    );
    expect(alerts).toEqual([]);
  });

  it("ما لا آيبانَ في نصّه مجهولٌ لا مخالف", () => {
    const alerts = findIbanAlerts(
      [{ id: "s1", savedIban: A, savedOn: "2026-01-01" }],
      [tx("t1", "2026-09-10", null)],
      own, "2026-07-01",
    );
    expect(alerts).toEqual([]);
  });

  it("حسابُ المقهى نفسِه في نصّ الحوالة ليس حسابَ المستفيد", () => {
    expect(payeeIbans(`من ${OWN} الى ${A}`, own)).toEqual([A]);
    const alerts = findIbanAlerts(
      [{ id: "s1", savedIban: A, savedOn: "2026-01-01" }],
      [{ id: "t1", supplierId: "s1", day: "2026-09-10", amountMinor: 5_00, text: `من ${OWN} الى ${A}` }],
      own, "2026-07-01",
    );
    expect(alerts).toEqual([]);
  });

  it("ما قبل نافذة التنبيه يبني المعروفَ ولا يُسأل عنه", () => {
    const alerts = findIbanAlerts(
      [{ id: "s1", savedIban: null, savedOn: null }],
      [tx("t1", "2025-01-01", A), tx("t2", "2025-02-01", A), tx("t3", "2025-03-01", B), tx("t4", "2026-09-01", C)],
      own, "2026-07-01",
    );
    expect(alerts.map((a) => a.seenIban)).toEqual([C]);
  });

  it("لا يخلط مورّداً بآخر، ومورّدٌ غير مطلوب لا يُفحَص", () => {
    const alerts = findIbanAlerts(
      [{ id: "s1", savedIban: A, savedOn: "2026-01-01" }],
      [tx("t1", "2026-09-10", B, 100_00, "s2"), tx("t2", "2026-09-11", A, 100_00, "s1")],
      own, "2026-07-01",
    );
    expect(alerts).toEqual([]);
  });

  it("المفتاحُ بالمورّد والآيبان معاً — حسابٌ ثالث سؤالٌ جديد", () => {
    expect(ibanAlertKey("s1", B)).toBe(`iban:s1:${B}`);
    expect(ibanAlertKey("s1", B)).not.toBe(ibanAlertKey("s1", C));
  });

  it("الآيبان يُعرض أربعاً أربعاً", () => {
    expect(groupIban(A)).toBe("SA03 8000 0000 6080 1016 7519");
  });
});

describe("أوّل حوالةٍ إلى حسابٍ جديد", () => {
  const lt = (id: string, day: string, iban: string | null, amountMinor: number, payee: string | null = "مستفيد"): LedgerTransfer => ({
    id, day, amountMinor, payee, text: iban ? `حوالة الى ${iban} من ${OWN}` : "سحب",
  });

  it("آيبانٌ لم يُرَ قبل النافذة وبلغ الحدّ يُذكر مرّةً بمجموعه", () => {
    const out = findFirstTransfers([lt("t1", "2026-10-01", B, 300_00), lt("t2", "2026-10-03", B, 400_00)], own, "2026-09-27");
    expect(out).toEqual([{
      iban: B, payee: "مستفيد", totalMinor: 700_00,
      transfers: [{ id: "t1", day: "2026-10-01", amountMinor: 300_00 }, { id: "t2", day: "2026-10-03", amountMinor: 400_00 }],
    }]);
  });

  it("ما حُوِّل له قبل النافذة معروفٌ لا يُذكر", () => {
    expect(findFirstTransfers([lt("t0", "2026-05-01", B, 50_00), lt("t1", "2026-10-01", B, 9_000_00)], own, "2026-09-27")).toEqual([]);
  });

  it("دون خمسمئة ريال لا يُذكر، وما لا آيبانَ فيه لا يُذكر", () => {
    expect(findFirstTransfers([lt("t1", "2026-10-01", B, 499_99), lt("t2", "2026-10-01", null, 9_000_00)], own, "2026-09-27")).toEqual([]);
    expect(findFirstTransfers([lt("t1", "2026-10-01", B, 500_00)], own, "2026-09-27")).toHaveLength(1);
  });

  it("حسابُ المقهى نفسِه ليس مستفيداً جديداً", () => {
    expect(findFirstTransfers([{ id: "t1", day: "2026-10-01", amountMinor: 9_000_00, payee: null, text: `تحويل من ${OWN}` }], own, "2026-09-27")).toEqual([]);
  });

  it("المفتاحُ بالآيبان وحده، وبادئتُه غيرُ بادئة حارس المورّد", () => {
    expect(firstTransferKey(B)).toBe(`iban-first:${B}`);
    expect(firstTransferKey(B).startsWith("iban:")).toBe(false);
  });
});

describe("آيبانٌ مشترك بين مورّدين كثُر", () => {
  it("ما ظهر في حوالات ثلاثة مورّدين ليس حسابَ أحدهم — ولا يُسأل به", () => {
    const transfers = [tx("t1", "2026-09-01", C, 100_00, "s1"), tx("t2", "2026-09-02", C, 100_00, "s2"), tx("t3", "2026-09-03", C, 100_00, "s3")];
    /* `tx` يكتب حسابَ المقهى في كلّ نصّ — فهو مشتركٌ كذلك */
    expect(sharedIbans(transfers)).toEqual(new Set([C, OWN]));
    const alerts = findIbanAlerts([{ id: "s1", savedIban: A, savedOn: "2026-01-01" }], transfers, sharedIbans(transfers), "2026-07-01");
    expect(alerts).toEqual([]);
  });

  it("حسابٌ عند مورّدَين فقط يبقى سؤالاً", () => {
    const transfers = [tx("t1", "2026-09-01", B, 100_00, "s1"), tx("t2", "2026-09-02", B, 100_00, "s2")];
    expect(sharedIbans(transfers).has(B)).toBe(false);
  });
});
