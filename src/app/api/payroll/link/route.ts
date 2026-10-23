/**
 * توزيعُ حوالةٍ على موظّفٍ بغرضها، وفكُّه، وقبولُ المقترحات جملةً.
 * لا يأخذ من المتصفّح إلّا المعرّفات والمبلغَ نصّاً — والقاعدةُ ترفض ما يتجاوز الحوالة.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { isPurpose } from "@/lib/payroll/calc";
import { Id, Month, Note, positiveMinor } from "@/lib/payroll/request";
import { formatRiyalsDisplay } from "@/lib/money";
import { countNoun, TRANSFER } from "@/lib/arabic";
import { failWith, guard } from "@/services/guard";
import { linkSuggested, linkTransfer, PayrollRefused, splitTransfer, transfersSince, unlinkTransfer, type LinkPart } from "@/services/payroll.service";

export const runtime = "nodejs";

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("link"), employeeId: Id, month: Month, purpose: z.string().refine(isPurpose, "غرض غير معروف"),
    bankTransactionId: Id, amount: z.string().trim().max(20).optional(), note: Note,
  }).strict(),
  z.object({
    action: z.literal("split"), bankTransactionId: Id,
    parts: z.array(z.object({
      employeeId: Id, month: Month, purpose: z.string().refine(isPurpose, "غرض غير معروف"),
      amount: z.string().trim().max(20).optional(), note: Note,
    }).strict()).min(1).max(40),
  }).strict(),
  z.object({ action: z.literal("unlink"), id: Id }).strict(),
  z.object({ action: z.literal("suggested"), month: Month, txIds: z.array(Id).min(1).max(200) }).strict(),
]);

export async function POST(request: Request) {
  try {
    const user = await guard("payroll-link", "payroll:edit");
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const b = read.body;
    if (b.action === "unlink") {
      const done = await unlinkTransfer(b.id, user.id);
      return NextResponse.json({ ok: true, message: done ? "فُكّ الربط، وعادت الحوالة غير موزّعة" : "فُكّ من قبل" });
    }
    if (b.action === "split") {
      const parts: LinkPart[] = [];
      for (const [i, p] of b.parts.entries()) {
        if (!isPurpose(p.purpose)) return NextResponse.json({ error: "غرض غير معروف" }, { status: 400 });
        let amountMinor: number | null = null;
        if (p.amount) {
          const amount = positiveMinor(p.amount);
          if (!amount.ok) return NextResponse.json({ error: `السطر ${i + 1}: ${amount.error}` }, { status: 400 });
          amountMinor = amount.minor;
        }
        parts.push({ employeeId: p.employeeId, month: p.month, purpose: p.purpose, amountMinor, note: p.note });
      }
      const amounts = await splitTransfer(b.bankTransactionId, parts, user.id);
      const total = amounts.reduce((s, a) => s + a, 0);
      return NextResponse.json({ ok: true, message: amounts.length === 1 ? `وُزّع ${formatRiyalsDisplay(total)} ريال من الحوالة` : `وُزّع ${formatRiyalsDisplay(total)} ريال على ${amounts.length === 2 ? "جزأين" : `${amounts.length} أجزاء`}` });
    }
    if (b.action === "suggested") {
      const r = await linkSuggested(b.txIds, transfersSince(b.month), user.id);
      return NextResponse.json({ ok: true, message: r.skipped > 0 ? `رُبط ${countNoun(r.linked, TRANSFER)}، وتُرك ${countNoun(r.skipped, TRANSFER)} تغيّرت أو رُبطت من قبل` : `رُبط ${countNoun(r.linked, TRANSFER)} بأصحابها رواتب` });
    }
    if (!isPurpose(b.purpose)) return NextResponse.json({ error: "غرض غير معروف" }, { status: 400 });
    let amountMinor: number | null = null;
    if (b.amount) {
      const amount = positiveMinor(b.amount);
      if (!amount.ok) return NextResponse.json({ error: amount.error }, { status: 400 });
      amountMinor = amount.minor;
    }
    const linked = await linkTransfer({ employeeId: b.employeeId, month: b.month, purpose: b.purpose, bankTransactionId: b.bankTransactionId, amountMinor, note: b.note }, user.id);
    return NextResponse.json({ ok: true, message: `وُزّع ${formatRiyalsDisplay(linked)} ريال من الحوالة` });
  } catch (e) {
    if (e instanceof PayrollRefused) return NextResponse.json({ error: e.message }, { status: 409 });
    return failWith(e, "payroll-link");
  }
}
