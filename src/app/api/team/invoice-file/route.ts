/**
 * صورةُ فاتورة الفريق لمستلم الفواتير في «TPH Team» — بلا جلسة، ورمزُه إذنُه.
 *
 *   GET ?token=…&id=… → الملفّ (صورة أو PDF)
 *
 * ما ينتظر من القاعدة، وما أُرشف من الدرايف **قراءةً** (`downloadFile` وحده — قيدُ الأرشيف) بتفويض
 * من أرشفه. ولا يُعرض إلّا ما يعرضه المتصفّح آمناً، وبايتاتُه تشهد لنوعه.
 */
import { NextResponse } from "next/server";
import { failWith } from "@/services/guard";
import { consume } from "@/services/rate-limit.service";
import { resolveCheckinToken } from "@/services/payroll.service";
import { inboxFileRef } from "@/services/team-invoices.service";
import { refreshTokenFor } from "@/services/drive.service";
import { downloadFile, driveForUser } from "@/lib/drive";
import { signatureMatches, sniffMimeType } from "@/lib/file-signature";

export const runtime = "nodejs";
export const maxDuration = 60;

const INLINE: ReadonlySet<string> = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"]);
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const employee = await resolveCheckinToken(url.searchParams.get("token"));
    if (!employee) return fail("هذا الرابط لم يعد يعمل.", 404);
    if (!employee.receivesInvoices) return fail("استلام الفواتير ليس من صلاحيتك.", 403);
    const id = url.searchParams.get("id") ?? "";
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return fail("معرّف الفاتورة غير صالح", 400);
    await consume("team-invoice-file", employee.id);
    const ref = await inboxFileRef(id);
    if (!ref) return fail("لا ملف لهذه الفاتورة.", 404);
    let data: Buffer, declared: string;
    if (ref.kind === "DB") {
      data = ref.data; declared = ref.mimeType;
    } else {
      const token = ref.ownerId ? await refreshTokenFor(ref.ownerId) : null;
      if (!token) return fail("الفاتورة أُرشفت ولا تُفتح من هنا الآن. اطلبها من الإدارة.", 409);
      try {
        const file = await downloadFile(driveForUser(token), ref.driveFileId);
        data = file.data; declared = ref.mimeType || file.mimeType;
      } catch (e) {
        console.error("[team-invoice-file] تعذّر جلب الورقة من الدرايف", e);
        return fail("تعذّر جلب الفاتورة. أعد المحاولة.", 502);
      }
    }
    const sniffed = sniffMimeType(data);
    const type = INLINE.has(declared) && signatureMatches(declared, data) ? declared : sniffed && INLINE.has(sniffed) ? sniffed : null;
    if (!type) return fail("هذا النوع من الملفات لا يُعرض هنا.", 415);
    return new NextResponse(new Uint8Array(data), {
      headers: { "content-type": type, "cache-control": "private, max-age=300", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" },
    });
  } catch (e) {
    return failWith(e, "team-invoice-file");
  }
}
