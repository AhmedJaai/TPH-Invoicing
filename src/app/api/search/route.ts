/**
 * البحث.
 *
 * قراءةٌ فقط، محروسة كغيرها. وحدّ طلباتها مرتفع لأنّها تُستدعى مع كل
 * حرف يُكتب تقريباً — والمكوّن يُمهل قبل أن يسأل.
 */
import { NextResponse } from "next/server";
import { guard, respondTo } from "@/services/guard";
import { search } from "@/services/search.service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await guard("search", "document:view");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const q = new URL(request.url).searchParams.get("q") ?? "";
  if (q.trim().length < 2) {
    return NextResponse.json({ hits: [], intent: null });
  }

  const { intent, hits } = await search(q);
  return NextResponse.json({ intent: intent?.kind ?? null, hits });
}
