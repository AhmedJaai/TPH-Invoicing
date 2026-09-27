/**
 * جسمُ الطلب يُقرأ ويُفحَص وقتَ التشغيل — لا `as Body`.
 *
 * كان كلُّ مسارٍ يكتب `(await request.json()) as Body`: النوعُ وعدٌ للمترجم لا
 * فحصٌ للطلب. فرقمٌ حيث يُنتظر نصّ (`total: 123` ← `v.trim()` يرمي)، أو نصٌّ حيث
 * تُنتظر قائمة (`invoiceIds: "x"` ← `inArray` يرمي)، يصير ٥٠٠ بلا جملة. والفحصُ
 * هنا يردّه ٤٠٠ برسالةٍ تقول أيّ حقل.
 */
import "@/lib/zod-ar";
import { NextResponse } from "next/server";
import type { z } from "zod";

export async function readJson<S extends z.ZodType>(
  request: Request,
  schema: S,
  /** طلبٌ بلا جسم (زرُّ «زامن» مثلاً) يُعامَل كائناً فارغاً. */
  options: { emptyOk?: boolean } = {},
): Promise<{ ok: true; body: z.infer<S> } | { ok: false; response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    if (!options.emptyOk) {
      return { ok: false, response: NextResponse.json({ error: "تعذّرت قراءة الطلب. أعد المحاولة، فإن تكرّر فأبلِغ مالك الحساب." }, { status: 400 }) };
    }
    raw = {};
  }
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.length ? ` (${issue.path.join(".")})` : "";
    return { ok: false, response: NextResponse.json({ error: `طلبٌ غير مفهوم${field}: ${issue?.message ?? ""}`.trim() }, { status: 400 }) };
  }
  return { ok: true, body: parsed.data };
}
