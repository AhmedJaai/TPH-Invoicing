/**
 * إذنُ رفعِ ملفٍّ كبير إلى المحطّة المؤقّتة (Vercel Blob) — المتصفّحُ يرفع إليها
 * مباشرةً، فلا يمرّ الملفّ بحدّ المنصّة (٤٫٥ ميجابايت).
 *
 *   POST (من `upload()` في `@vercel/blob/client`) → إذنٌ قصيرُ العمر لاسمٍ تحت `staging/`
 *
 * الحارسُ صلاحيةُ الرفع نفسُها (`document:upload`)، والحجمُ والنوعُ يُفرضان على الإذن
 * نفسه فلا يتجاوزهما المتصفّح. ولا مخزن = ٤٠٤ برسالة: الشاشةُ لا تطلبه أصلاً.
 *
 * وطريقان (`blobUploadMode`): بالمفتاح (`BLOB_READ_WRITE_TOKEN`) إذنُ عميلٍ من `handleUpload`؛
 * وبلا مفتاح ومع `BLOB_STORE_ID` رابطٌ موقَّع من `handleUploadPresigned` يصادقه رمزُ OIDC
 * الذي تعطيه Vercel للدالّة (`issueSignedToken`) — `handleUpload` يطلب المفتاحَ ولا يعمل بغيره.
 * والمفتاحُ يغلب إن وُجدا معاً. والمتصفّحُ يعرف الطريقَ من الصفحة (`uploadPresigned`).
 *
 * ولا نداءَ رجوعٍ من Blob (`onUploadCompleted`): كلُّ طلبٍ هنا من مستخدمٍ بجلسة. والملفُّ
 * يُقرأ ويُحذف في `/api/analyze` و`/api/archive` (`blob-staging.ts`).
 */
import { after, NextResponse } from "next/server";
import { handleUpload, handleUploadPresigned, type HandleUploadBody } from "@vercel/blob/client";
import { issueSignedToken } from "@vercel/blob";
import { z } from "zod";
import { guard, respondTo } from "@/services/guard";
import { blobAuthOptions, sweepStaleStaged } from "@/lib/blob-staging";
import { stagingTokenDecision } from "@/lib/blob-staging-policy";

export const runtime = "nodejs";

/** إذنُ الرفع يعيش عشر دقائق — يكفي ملفّاً بخمسة وعشرين ميجابايت على شبكة جوّال */
const TOKEN_LIFETIME_MS = 10 * 60 * 1000;

/** طلبُ الإذن كما يرسله `upload()` — يُفحَص شكلُه قبل أن يُعطى شيء */
const Payload = z.object({
  pathname: z.string().min(1).max(300),
  multipart: z.boolean(),
  clientPayload: z.string().max(500).nullable(),
});
/** ولا يُقبل «اكتمل الرفع» — لا نداءَ رجوعٍ نطلبه، فلا يُتحقَّق من توقيعٍ هنا */
const TokenRequest = z.discriminatedUnion("type", [
  z.object({ type: z.literal("blob.generate-client-token"), payload: Payload }),
  z.object({ type: z.literal("blob.generate-presigned-url"), payload: Payload }),
]);

/** ما يرسله المتصفّح مع الطلب: نوعُ الملفّ — يُقابَل بالمقبول قبل الإذن */
const ClientPayload = z.object({ contentType: z.string().max(120) });

export async function POST(request: Request) {
  try {
    await guard("upload-blob", "document:upload");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const auth = blobAuthOptions();
  if (!auth) {
    return NextResponse.json({ error: "رفع الملفات الكبيرة غير مفعّل. الحد الأقصى 3 ميجابايت للملف." }, { status: 404 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "تعذّرت قراءة الطلب. أعد المحاولة." }, { status: 400 });
  }
  const parsed = TokenRequest.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "الطلب غير مفهوم" }, { status: 400 });

  let contentType: string | null = null;
  if (parsed.data.payload.clientPayload !== null) {
    let payload: unknown = null;
    try {
      payload = JSON.parse(parsed.data.payload.clientPayload);
    } catch {
      /* يُردّ أدناه */
    }
    const cp = ClientPayload.safeParse(payload);
    if (!cp.success) return NextResponse.json({ error: "الطلب غير مفهوم" }, { status: 400 });
    contentType = cp.data.contentType;
  }

  const decision = stagingTokenDecision(parsed.data.payload.pathname, contentType);
  if (!decision.ok) return NextResponse.json({ error: decision.error }, { status: 400 });

  /* المتروكُ في المحطّة أكثرَ من يوم يُكنَس بعد الردّ — لا يؤخّر الرفع */
  after(() => sweepStaleStaged().catch(() => undefined));

  try {
    const validUntil = Date.now() + TOKEN_LIFETIME_MS;
    if ("token" in auth) {
      if (parsed.data.type !== "blob.generate-client-token") return NextResponse.json({ error: "الطلب غير مفهوم" }, { status: 400 });
      const body: HandleUploadBody = { type: parsed.data.type, payload: parsed.data.payload };
      const out = await handleUpload({
        request,
        body,
        token: auth.token,
        onBeforeGenerateToken: async () => ({
          allowedContentTypes: decision.allowedContentTypes,
          maximumSizeInBytes: decision.maximumSizeInBytes,
          addRandomSuffix: true,
          validUntil,
        }),
      });
      return NextResponse.json(out);
    }
    if (parsed.data.type !== "blob.generate-presigned-url") return NextResponse.json({ error: "الطلب غير مفهوم" }, { status: 400 });
    /*
      OIDC: الإذنُ لاسمٍ واحدٍ بعينه وللكتابة وحدها، بالحدّ والنوع نفسيهما. والاسمُ فريدٌ من
      المتصفّح (`stagingPathname` بلاحقةٍ عشوائيّة) لأنّ اللاحقةَ هنا تغيّر الاسمَ الذي أُذن له.
      ومفتاحُ التحقّق من نداء الرجوع لا يُستعمل (لا نداء)، فيُمرَّر ما وُجد أو علامةٌ لا تتحقّق.
    */
    const out = await handleUploadPresigned({
      request,
      body: { type: parsed.data.type, payload: parsed.data.payload },
      webhookPublicKey: process.env.BLOB_WEBHOOK_PUBLIC_KEY?.trim() || "unused-no-callback",
      getSignedToken: async (pathname) => ({
        token: await issueSignedToken({
          storeId: auth.storeId,
          pathname,
          operations: ["put"],
          validUntil,
          allowedContentTypes: decision.allowedContentTypes,
          maximumSizeInBytes: decision.maximumSizeInBytes,
        }),
        urlOptions: {
          allowedContentTypes: decision.allowedContentTypes,
          maximumSizeInBytes: decision.maximumSizeInBytes,
          validUntil,
        },
      }),
    });
    return NextResponse.json(out);
  } catch {
    return NextResponse.json({ error: "تعذّر تجهيز رفع الملف الكبير. أعد المحاولة بعد قليل." }, { status: 502 });
  }
}
