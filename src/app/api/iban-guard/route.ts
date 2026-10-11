/**
 * قرارُ صاحب المقهى في «حوالةٌ إلى حسابٍ غير حساب المورّد المعروف» — `iban-guard.service.ts`.
 * «أعرفه» يُغلق السؤال عن هذا الحساب، و«OPEN» يعيده. لا يمسّ حوالةً ولا دفعة.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { guard, respondTo } from "@/services/guard";
import { readJson } from "@/lib/request-body";
import { IbanAlertGone, resolveFirstTransfer, resolveIbanAlert } from "@/services/iban-guard.service";

export const runtime = "nodejs";

const Body = z.object({
  /** يغيب في «أوّلُ حوالةٍ إلى حسابٍ جديد» — قرارُها بالآيبان وحده. */
  supplierId: z.string().trim().min(1).max(64).optional(),
  iban: z.string().trim().regex(/^SA\d{22}$/i, "آيبانٌ غير مفهوم"),
  decision: z.enum(["KNOWN", "OPEN"]),
  note: z.string().trim().max(500).optional(),
});

export async function POST(request: Request) {
  try {
    const user = await guard("iban-guard", "bank:edit");
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const { supplierId, iban, decision } = read.body;
    const note = read.body.note || null;
    if (!supplierId) {
      const first = await db.transaction((t) => resolveFirstTransfer(t, { iban, decision, note }, user.id));
      return NextResponse.json({
        ok: true,
        message: decision === "OPEN"
          ? "أُعيد فتح السؤال عن هذا المستفيد"
          : `حُفظ: ${first.payee ?? "مستفيدٌ"} تعرفه — لن يُذكر ثانيةً`,
      });
    }
    const alert = await db.transaction((t) => resolveIbanAlert(t, { supplierId, iban, decision, note }, user.id));
    return NextResponse.json({
      ok: true,
      message: decision === "OPEN"
        ? `أُعيد فتح السؤال عن حساب ${alert.supplierName}`
        : `حُفظ: حسابٌ لـ${alert.supplierName} تعرفه — خرج التنبيه، ويعود إن ظهر حسابٌ آخر`,
    });
  } catch (e) {
    if (e instanceof IbanAlertGone) return NextResponse.json({ error: e.message }, { status: 409 });
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
