import { describe, expect, it } from "vitest";
import { labelRecorded, type CaptureReading, type RecordedInvoice } from "./capture-recorded";
import type { SupplierRecord } from "./supplier-match";

const oska: SupplierRecord = {
  id: "s-oska", slug: "oska", nameAr: "أوسكا — شركة المشروبات النقية", nameEn: "Pure Beverages",
  driveFolderName: "Oska", vatNumber: "310506047200003", issuesInvoices: true, contractOnFile: false, aliases: [],
};
const reading = (over: Partial<CaptureReading>): CaptureReading => ({
  id: "c1", sellerVatNumber: "310506047200003", supplierNameAr: "شركة المشروبات النقية", supplierNameEn: "",
  invoiceNumber: "IN003215-04637", totalAmount: "476.10", ...over,
});
const invoice = (over: Partial<RecordedInvoice>): RecordedInvoice => ({
  id: "i1", supplierId: "s-oska", supplierName: oska.nameAr, invoiceNumber: "IN003215-04637", totalMinor: 47_610, fromStatement: false, ...over,
});

describe("صورُ الفريق المسجّلة من قبل", () => {
  it("قُيِّدت بملفّها: تكرارٌ يُترك", () => {
    const m = labelRecorded([reading({})], [oska], [invoice({})]);
    expect(m.get("c1")).toMatchObject({ kind: "RECORDED", invoiceId: "i1" });
  });

  it("قُيِّدت من الكشف بلا ملف: لا تُترك — اعتمادُها يربط الملف", () => {
    const m = labelRecorded([reading({})], [oska], [invoice({ fromStatement: true })]);
    expect(m.get("c1")?.kind).toBe("STATEMENT_NO_FILE");
  });

  it("الرقمُ موحَّداً: «04» و«4» فاتورةٌ واحدة", () => {
    const m = labelRecorded([reading({ invoiceNumber: "4" })], [oska], [invoice({ invoiceNumber: "04" })]);
    expect(m.get("c1")?.kind).toBe("RECORDED");
  });

  it("صُوّرت مرّتين: الثانيةُ توأمُ الأولى، والأولى بلا وسم", () => {
    const m = labelRecorded([reading({ id: "a" }), reading({ id: "b" })], [oska], []);
    expect(m.has("a")).toBe(false);
    expect(m.get("b")).toMatchObject({ kind: "TWIN", twinOf: "a" });
  });

  it("مورّدٌ لم يُعرف: الرقمُ وحده لا يكفي، ومعه الإجماليُّ بالهللة ترجيح", () => {
    const unknown = reading({ sellerVatNumber: "", supplierNameAr: "مورّد غريب" });
    expect(labelRecorded([unknown], [], [invoice({ totalMinor: 50_000 })]).has("c1")).toBe(false);
    expect(labelRecorded([unknown], [], [invoice({})]).get("c1")?.kind).toBe("LIKELY");
  });

  it("رقمٌ آخر للمورّد نفسه ليس تكراراً، وما لا رقمَ له لا يُوسم", () => {
    expect(labelRecorded([reading({ invoiceNumber: "IN003215-09999" })], [oska], [invoice({})]).size).toBe(0);
    expect(labelRecorded([reading({ invoiceNumber: "" })], [oska], [invoice({})]).size).toBe(0);
  });
});
