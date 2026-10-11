/**
 * رفعُ كتالوج فودكس: أصنافُ المخزون · الأصناف المباعة · الوصفات.
 *
 * وثلاثتُها في طلبٍ واحد عمداً: الوصفةُ تربط طرفين، فلو رُفعت وحدَها
 * لسقطت كلُّها بحجّة «مكوّنُه ليس عندنا». والملفُّ يُعرَف بأعمدته لا
 * بترتيب رفعه ولا باسمه.
 *
 * **والمعاينةُ قبل الكتابة**: الحسابُ يجري كاملاً في معاملةٍ تُلغى،
 * فيُعرَض ما سيقع بالضبط — كما تُعايَن دفعةُ أوّل الشهر قبل إقرارها.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { foodicsConfigured } from "@/lib/foodics/client";
import { guard, respondTo, failWith } from "@/services/guard";
import { importFoodicsCatalog, importParsedCatalog, type CatalogFile } from "@/services/catalog-import.service";
import { fetchFoodicsCatalog } from "@/services/foodics-sync.service";

export const runtime = "nodejs";
export const maxDuration = 60;

/** كتالوجُ مقهىً كامل لا يبلغ ميجابايت — والحدُّ يمنع رفعَ غيره. */
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_FILES = 3;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const ApiBody = z.object({
  source: z.literal("foodics-api"),
  effectiveFrom: z.string().regex(DATE, "تاريخُ سريان الوصفات يُكتب YYYY-MM-DD"),
  dryRun: z.boolean().optional(),
}).strict();

export async function POST(request: Request) {
  let user;
  try {
    /*
      الكتالوجُ يكتب وصفاتٍ تُحسَب بها كلفةُ الفرق — فصلاحيّتُه
      صلاحيّةُ الوصفات، لا صلاحيّةُ العدّ وحدَها.
    */
    user = await guard("inventory-catalog", "recipe:edit");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  /* ── من واجهة فودكس مباشرةً: الطلبُ JSON لا ملفّات، والمسارُ بعده واحد ── */
  if ((request.headers.get("content-type") ?? "").includes("application/json")) {
    const read = await readJson(request, ApiBody);
    if (!read.ok) return read.response;
    if (!foodicsConfigured()) {
      return NextResponse.json({ error: "فودكس غير موصول: مفتاحُ الربط غير مضبوطٍ في بيئة الخادم. ارفع الملفّات الثلاثة بدلاً منه." }, { status: 409 });
    }
    try {
      const parsed = await fetchFoodicsCatalog();
      return NextResponse.json(await importParsedCatalog(parsed, {
        effectiveFrom: read.body.effectiveFrom, actorId: user.id, dryRun: read.body.dryRun === true,
      }));
    } catch (e) {
      return failWith(e, "inventory-catalog");
    }
  }

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "تعذّرت قراءة الطلب" }, { status: 400 });

  const uploads = form.getAll("files").filter((f): f is File => f instanceof File);
  if (uploads.length === 0) return NextResponse.json({ error: "لم يصل ملفّ" }, { status: 400 });
  if (uploads.length > MAX_FILES) {
    return NextResponse.json({ error: `ثلاثةُ ملفّاتٍ على الأكثر` }, { status: 400 });
  }
  for (const f of uploads) {
    if (f.size > MAX_BYTES) {
      return NextResponse.json({ error: `«${f.name}» أكبر من ٤ ميجابايت` }, { status: 400 });
    }
  }

  const effectiveFrom = String(form.get("effectiveFrom") ?? "").trim();
  if (!DATE.test(effectiveFrom)) {
    return NextResponse.json({ error: "تاريخُ سريان الوصفات يُكتب YYYY-MM-DD" }, { status: 400 });
  }

  const files: CatalogFile[] = [];
  for (const f of uploads) {
    files.push({ fileName: f.name, buffer: Buffer.from(await f.arrayBuffer()) });
  }

  try {
    const result = await importFoodicsCatalog({
      files,
      effectiveFrom,
      actorId: user.id,
      dryRun: String(form.get("dryRun") ?? "") === "true",
    });
    return NextResponse.json(result);
  } catch (e) {
    return failWith(e, "inventory-catalog");
  }
}
