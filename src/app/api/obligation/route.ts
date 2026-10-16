/**
 * وثيقةٌ لها تاريخُ انتهاء — إضافةٌ وتعديلٌ (ومنه التجديد) وأرشفةٌ وإعادة.
 *
 * لا مالَ هنا. والتاريخُ يُفحص وجودُه لا شكلُه وحده («٣٠ فبراير» يُردّ)، والمهلةُ
 * بين يومٍ ومئةٍ وثمانين. والأرشفةُ لا تحذف، وكلُّ كتابةٍ في سجلّ التدقيق.
 */
import { z } from "zod";
import { NextResponse } from "next/server";
import { readJson } from "@/lib/request-body";
import { guard, respondTo } from "@/services/guard";
import { DEFAULT_REMIND_DAYS, MAX_REMIND_DAYS, OBLIGATION_KINDS, isRealDay } from "@/lib/obligations";
import { createObligation, setObligationClosed, updateObligation, type ObligationInput } from "@/services/obligation.service";

export const runtime = "nodejs";

const Id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "معرّف غير صالح");
const optional = (max: number) => z.string().max(max).optional();

const Fields = z.object({
  kind: z.enum(OBLIGATION_KINDS),
  title: z.string().trim().min(2, "اكتب اسم الوثيقة").max(120),
  issuer: optional(120),
  reference: optional(80),
  holder: optional(120),
  expiresOn: z.string().refine(isRealDay, "تاريخ الانتهاء غير صالح — بصيغة YYYY-MM-DD"),
  remindDays: z.number().int().min(1, "المهلة يوم على الأقلّ").max(MAX_REMIND_DAYS, `المهلة ${MAX_REMIND_DAYS} يوماً على الأكثر`).optional(),
  note: optional(500),
});

const Body = z.discriminatedUnion("action", [
  Fields.extend({ action: z.literal("create") }),
  Fields.extend({ action: z.literal("update"), id: Id }),
  z.object({ action: z.literal("close"), id: Id }),
  z.object({ action: z.literal("reopen"), id: Id }),
]);

const clean = (v: string | undefined) => v?.trim() || null;

function toInput(f: z.infer<typeof Fields>): ObligationInput {
  return {
    kind: f.kind,
    title: f.title,
    issuer: clean(f.issuer),
    reference: clean(f.reference),
    holder: clean(f.holder),
    expiresOn: f.expiresOn,
    remindDays: f.remindDays ?? DEFAULT_REMIND_DAYS,
    note: clean(f.note),
  };
}

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("obligation", "expense:edit");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const read = await readJson(request, Body);
  if (!read.ok) return read.response;
  const body = read.body;

  try {
    if (body.action === "create") {
      const id = await createObligation(toInput(body), user.id);
      return NextResponse.json({ ok: true, id, message: `أضيفت «${body.title}»` });
    }
    const found =
      body.action === "update" ? await updateObligation(body.id, toInput(body), user.id)
      : await setObligationClosed(body.id, body.action === "close", user.id);
    if (!found) return NextResponse.json({ error: "الوثيقة غير موجودة — ربما حذفت. حدّث الصفحة" }, { status: 404 });
    return NextResponse.json({
      ok: true,
      message: body.action === "update" ? "حفظ التعديل" : body.action === "close" ? "أرشفت — لن يذكّر بها" : "أعيدت إلى المتابعة",
    });
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
