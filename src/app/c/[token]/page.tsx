import type { Metadata } from "next";
import { BrandMark } from "@/components/icons";
import { Scanner } from "@/components/scan/scanner";
import { recentForLink, resolveLink } from "@/services/capture.service";

export const dynamic = "force-dynamic";

/*
  الرابطُ يُثبَّت على الشاشة الرئيسيّة فيفتح هذه الصفحة لا صفحةَ الدخول:
  بيانُ تثبيتٍ لكلّ رابط برمزه. ولا يُفهرَس — الرابطُ إذن.
*/
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  return {
    title: "صوّر الفاتورة · ذا بوبليك هاوس",
    robots: { index: false, follow: false },
    referrer: "no-referrer",
    manifest: `/c/${encodeURIComponent(token)}/manifest.webmanifest`,
    appleWebApp: { capable: true, title: "صوّر الفاتورة", statusBarStyle: "default" },
  };
}

/**
 * صفحةُ الباريستا — يصوّر الفاتورة الورقيّة حين تصل، ويعرف أنّها واضحة قبل أن يرسلها.
 *
 * بلا دخول: الرابطُ الشخصيّ (`capture_links`) هو الإذن، ولا يملك إلّا أن يضع صورةً
 * في الانتظار. لا يرى مستنداً ولا مورّداً ولا مبلغاً غير ما قُرئ من ورقته.
 */
export default async function CapturePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await resolveLink(token);

  if (!link) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-surface px-6 text-center">
        <BrandMark className="h-10 w-auto text-accent" />
        <h1 className="mt-6 text-xl font-bold">هذا الرابط لم يعد يعمل</h1>
        <p className="mt-2 max-w-xs text-sm leading-relaxed text-ink-soft">
          ربما أُلغي أو نُسخ ناقصاً. اطلب من المدير رابطاً جديداً، ثم افتحه من هذا الجوال.
        </p>
      </main>
    );
  }

  const recent = await recentForLink(link.id);
  return (
    <Scanner
      token={token}
      label={link.label}
      recent={recent.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))}
    />
  );
}
