/**
 * إذنُ رفعِ ملفٍّ كبير إلى المحطّة المؤقّتة (Vercel Blob) — المتصفّحُ يرفع إليها
 * مباشرةً، فلا يمرّ الملفّ بحدّ المنصّة (٤٫٥ ميجابايت).
 *
 *   POST (من `upload()` في `@vercel/blob/client`) → إذنٌ قصيرُ العمر لاسمٍ تحت `staging/`
 *
 * الحارسُ صلاحيةُ الرفع نفسُها (`document:upload`)، والحجمُ والنوعُ يُفرضان على الإذن
 * نفسه فلا يتجاوزهما المتصفّح. ولا مخزن = ٤٠٤ برسالة: الشاشةُ لا تطلبه أصلاً.
 *
 * ولا نداءَ رجوعٍ من Blob (`onUploadCompleted`): كلُّ طلبٍ هنا من مستخدمٍ بجلسة. والملفُّ
 * يُقرأ ويُحذف في `/api/analyze` و`/api/archive` (`blob-staging.ts`).
 */
import { after, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { z } from "zod";
import { guard, respondTo } from "@/services/guard";
import { largeUploadsEnabled, sweepStaleStaged } from "@/lib/blob-staging";
import { stagingTokenDecision } from "@/lib/blob-staging-policy";

export const runtime = "nodejs";

/** إذنُ الرفع يعيش عشر دقائق — يكفي ملفّاً بخمسة وعشرين ميجابايت على شبكة جوّال */
const TOKEN_LIFETIME_MS = 10 * 60 * 1000;

/** طلبُ الإذن كما يرسله `upload()` — يُفحَص شكلُه قبل أن يُعطى شيء */
const TokenRequest = z.object({
  type: z.literal("blob.generate-client-token"),
  payload: z.object({
    pathname: z.string().min(1).max(300),
    multipart: z.boolean(),
    clientPayload: z.string().max(500).nullable(),
  }),
});

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

  if (!largeUploadsEnabled()) {
    return NextResponse.json({ error: "رفع الملفات الكبيرة غير مفعّل. الحد الأقصى ٣ ميجابايت للملف." }, { status: 404 });
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
    const body: HandleUploadBody = parsed.data;
    const out = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: decision.allowedContentTypes,
        maximumSizeInBytes: decision.maximumSizeInBytes,
        addRandomSuffix: true,
        validUntil: Date.now() + TOKEN_LIFETIME_MS,
      }),
    });
    return NextResponse.json(out);
  } catch {
    return NextResponse.json({ error: "تعذّر تجهيز رفع الملف الكبير. أعد المحاولة بعد قليل." }, { status: 502 });
  }
}
