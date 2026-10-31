/**
 * البحث.
 *
 * قراءةٌ فقط، محروسة كغيرها. وحدّ طلباتها مرتفع لأنّها تُستدعى مع كل
 * حرف يُكتب تقريباً — والمكوّن يُمهل قبل أن يسأل.
 */
import { NextResponse } from "next/server";
import { guard, respondTo } from "@/services/guard";
import { search } from "@/services/search.service";
import { can } from "@/lib/permissions";

export const runtime = "nodejs";

export async function GET(request: Request) {
  /* الطلبُ كلُّه لا الحارسُ وحده: خطأُ عملٍ معروف (شهرٌ مقفل، قيدٌ في القاعدة) يُقال بنصّه لا ٥٠٠ */
  try {
    return await handle(request);
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}

async function handle(request: Request) {
  const user = await guard("search", "document:view");

  const q = new URL(request.url).searchParams.get("q") ?? "";
  if (q.trim().length < 2) {
    return NextResponse.json({ hits: [], intent: null });
  }

  const { intent, hits } = await search(q, {
    amounts: can(user.role, "amounts:view"),
    bank: can(user.role, "bank:view"),
    salaries: can(user.role, "payroll:view"),
  });
  return NextResponse.json({ intent: intent?.kind ?? null, hits });
}
