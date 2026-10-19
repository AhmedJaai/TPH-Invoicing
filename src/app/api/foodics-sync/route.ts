/**
 * «زامن فودكس» — يقرأ ما تغيّر منذ آخر مرّة ويكتبه في المرآة وفي مجال المبيعات.
 *
 * قراءةٌ من فودكس وحدها؛ والكتابةُ في قاعدتنا بمعرّفاته، فالضغطُ مرّتين لا يضاعف.
 * والمسارُ عمرُه ستّون ثانية: المزامنةُ تقف عند موعدٍ معلَن وتقول «بقي ما يُكمَل»
 * بدل أن تُقتَل صامتة. والتعبئةُ الأولى (أشهرٌ) من الجهاز: `npm run foodics:sync`.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { foodicsConfigured } from "@/lib/foodics/client";
import { guard, respondTo } from "@/services/guard";
import { randomUUID } from "node:crypto";
import { runFoodicsSync } from "@/services/foodics-sync.service";
import { acquireLease, releaseLease } from "@/services/job-state.service";

export const runtime = "nodejs";
export const maxDuration = 60;

/** ما يُترَك للكتابة الأخيرة والردّ من عمر المسار. */
const BUDGET_MS = 40_000;

/*
  مزامنةٌ واحدةٌ في كلّ لحظة: الخلفيّةُ تُطلَق من كلّ جهازٍ ولسانٍ بتوقيته، فبدأت
  اثنتان بفارق ثلاث ثوانٍ (١٩ أكتوبر ٢٠٢٦) وسقطت الثانية. والعقدُ أطولُ من عمر المسار
  فلا ينقضي وصاحبُه يعمل، وينقضي وحده إن قتلته المنصّة.
*/
const SYNC_LEASE = "foodics-sync-lease";
const SYNC_LEASE_MS = 70_000;

const Body = z.object({ background: z.boolean().optional() }).strict();

export async function POST(request: Request) {
  let user;
  try {
    /* تكتب مبيعاتٍ يُحسَب منها الجرد — صلاحيةُ رفع ملفّ المبيعات نفسُها */
    user = await guard("foodics-sync", "inventory:count");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
  const read = await readJson(request, Body);
  if (!read.ok) return read.response;

  if (!foodicsConfigured()) {
    /* الخلفيّةُ تسأل كلَّ بضع ساعات — وغيابُ المفتاح حالٌ معلومة لا عطلٌ يُصاح به */
    if (read.body.background) return NextResponse.json({ ok: true, configured: false });
    return NextResponse.json({ error: "فودكس غير متصل: مفتاح الربط غير مضبوط في إعدادات الخادم." }, { status: 409 });
  }

  const holder = randomUUID();
  if (!(await acquireLease(SYNC_LEASE, holder, SYNC_LEASE_MS))) {
    const error = "مزامنة أخرى مع فودكس تجري الآن من جهاز أو تبويب آخر. انتظر دقيقة ثم أعد المحاولة.";
    return read.body.background
      ? NextResponse.json({ ok: true, configured: true, busy: true })
      : NextResponse.json({ busy: true, error }, { status: 409 });
  }
  let result;
  try {
    result = await runFoodicsSync({ actorId: user.id, budgetMs: BUDGET_MS });
  } finally {
    await releaseLease(SYNC_LEASE, holder).catch(() => undefined);
  }
  if (result.status === "FAILED") {
    return NextResponse.json({ error: `تعذّرت مزامنة فودكس: ${result.error ?? "سبب غير معروف"}` }, { status: 502 });
  }
  const c = result.counts;
  const parts = [
    c.salesWritten > 0 ? `${c.salesWritten} طلباً جديداً` : null,
    c.salesRestated > 0 ? `${c.salesRestated} طلباً أُعيدت قراءته` : null,
    c.linesRevised > 0 ? `${c.linesRevised} سطراً تغيّر` : null,
    c.rejected > 0 ? `${c.rejected} لم تُقرأ` : null,
  ].filter(Boolean);
  return NextResponse.json({
    ok: true,
    configured: true,
    status: result.status,
    counts: { ...c, problems: c.problems.slice(0, 10) },
    message: result.status === "PARTIAL"
      ? "قُرئ جزء من البيانات وانتهت المهلة. اضغط مرة أخرى لإكمال الباقي."
      : parts.length > 0 ? `تمت المزامنة: ${parts.join(" · ")}.` : "تمت المزامنة، ولا جديد منذ آخر مزامنة.",
  });
}
