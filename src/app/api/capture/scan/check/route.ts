/**
 * فحصُ وضوح صورة الباريستا قبل إرسالها — بلا جلسة، والرمزُ إذنُه.
 *
 *   POST multipart { token, file } → { verdict } | { outage, message } | { duplicate }
 *
 * يقرأ الورقة بالذكاء ويقول ما قرأه (المورّد · الرقم · التاريخ · الإجمالي) ليقارنه
 * المصوِّر بالورقة في يده. لا يحفظ صورةً — الإرسالُ خطوةٌ بعده. والقراءةُ تُحفظ
 * ببصمة الملفّ، فالإرسالُ وفتحُ صاحب العمل لها لا يُدفعان ثانيةً.
 */
import { NextResponse } from "next/server";
import { withDeadline } from "@/lib/ai/deadline";
import { failWith } from "@/services/guard";
import { consume } from "@/services/rate-limit.service";
import { alreadyArrived, CaptureInputError, inspectFile, readForClarity, resolveLink } from "@/services/capture.service";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  return withDeadline(55_000, () => handle(request));
}

/**
 * تسخينٌ يطلبه الماسحُ حين يُفتح — `GET` بلا رمزٍ ولا قاعدة.
 *
 * المسارُ يُطلب نادراً فيبدأ بارداً في كلّ مرّة تقريباً: قيس في الإنتاج نحو سبع ثوانٍ
 * قبل أوّل نداءٍ للنموذج. فيُحمَّل الآن ما تحتاجه القراءةُ (sharp وفكُّ الرمز) والباريستا
 * ما زال يصوّر، فيجد «افحص الوضوح» نسخةً دافئة.
 */
export async function GET() {
  await Promise.all([import("sharp"), import("qr/decode.js")]).catch(() => undefined);
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

async function handle(request: Request) {
  try {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: "لم تصل الصورة كاملة. أعد المحاولة." }, { status: 400 });
    }
    const link = await resolveLink(String(form.get("token") ?? ""));
    if (!link) return NextResponse.json({ error: "هذا الرابط لم يعد يعمل. اطلب رابطاً جديداً من المدير." }, { status: 404 });
    await consume("capture-check", link.id);

    const file = await inspectFile(form.get("file"));
    const where = await alreadyArrived(file.sha256);
    if (where) return NextResponse.json({ duplicate: where });

    const out = await readForClarity(file, link.createdById);
    if (out.ok) return NextResponse.json({ verdict: out.verdict });
    return NextResponse.json({ outage: out.outage, message: out.message });
  } catch (e) {
    if (e instanceof CaptureInputError) return NextResponse.json({ error: e.message }, { status: e.status });
    return failWith(e, "capture-check");
  }
}
