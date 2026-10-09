/**
 * رفعُ ملفّ مبيعات فودكس.
 *
 * والملفّ عينُه مرّتين **ليس خطأً**: يُردّ بـ200 وحالِ `DUPLICATE`
 * ومعه نتيجةُ استيراده الأوّل. فرفعُ الملفّ ثانيةً فعلٌ طبيعيّ حين
 * يشكّ صاحبُه، والجوابُ الصحيح «هذا عندي، وهذه نتيجتُه» لا «فشل».
 */
import { NextResponse } from "next/server";
import { guard, respondTo, failWith } from "@/services/guard";
import { importSalesFile } from "@/services/sales-import.service";
import { MAX_SALES_FILE_BYTES, SALES_FILE_TOO_LARGE } from "@/lib/sales/file-import";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("inventory-import", "inventory:count");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const fallbackBusinessDate = String(form?.get("businessDate") ?? "").trim() || undefined;
  const branchLabel = String(form?.get("branch") ?? "").trim() || undefined;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "لم يصل ملفّ" }, { status: 400 });
  }
  if (file.size > MAX_SALES_FILE_BYTES) {
    return NextResponse.json({ error: SALES_FILE_TOO_LARGE }, { status: 413 });
  }
  if (fallbackBusinessDate && !/^\d{4}-\d{2}-\d{2}$/.test(fallbackBusinessDate)) {
    return NextResponse.json({ error: "التاريخ يُكتب YYYY-MM-DD" }, { status: 400 });
  }

  try {
    const result = await importSalesFile({
      buffer: Buffer.from(await file.arrayBuffer()),
      fileName: file.name,
      actorId: user.id,
      fallbackBusinessDate,
      branchLabel,
    });

    /* «لم يُفهَم الملفّ» ليس عطباً في الخادم — هو خبرٌ عن الملفّ */
    if (result.status === "FAILED" && result.blocked) {
      return NextResponse.json(result, { status: 422 });
    }
    return NextResponse.json(result);
  } catch (e) {
    return failWith(e, "inventory-import");
  }
}
