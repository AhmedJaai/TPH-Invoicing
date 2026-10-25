/**
 * استيراد كشف البنك ومطابقة مدفوعاته بالفواتير.
 *
 * البابُ وحده: الحارس، وفحصُ الملفّ (وصل؟ وحجمُه؟)، ونداءٌ واحد لـ`runStatementImport`
 * (`services/statement-import.service.ts`) — هناك المزامنةُ والتسويةُ والكتابة.
 */
import { NextResponse } from "next/server";
import { answer, guard, respondTo } from "@/services/guard";
import { runStatementImport } from "@/services/statement-import.service";
import { withDeadline } from "@/lib/ai/deadline";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 4 * 1024 * 1024 /* تحت حدّ المنصّة لجسم الطلب (٤٫٥) */;

async function handle(request: Request) {
  let user;
  try {
    user = await guard("bank-import", "bank:edit");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const apply = form?.get("apply") === "true";

  if (!(file instanceof File)) return NextResponse.json({ error: "لم يصل أي ملف" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "الملف أكبر من 4 ميجابايت" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const userId = user.id;
  return answer(() => runStatementImport(userId, { name: file.name, type: file.type, buffer }, apply));
}

/* النداءات تحت عمر المسار — تقف بمهلةٍ معلَنة قبل أن تقتلها المنصّة */
export async function POST(request: Request) {
  return withDeadline(55_000, () => handle(request));
}
