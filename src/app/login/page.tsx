import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";

/**
 * رسائل تعذُّر الدخول — مكتوبةً لمن يقرؤها.
 *
 * كانت خمسٌ من سبعٍ تخاطب من بنى النظام: «راجع متغيّرات جوجل في
 * الخادم» و«راجع Client ID و Client Secret» و«يلزم حذف سجلّه». وهذه
 * أسوأ شاشةٍ يقع فيها ذلك، لأنّ من يراها هو بالتحديد **من لا يستطيع
 * الدخول ليصلح شيئاً** — فيُعطى أمراً لا يملك تنفيذه، ولا يُعطى ما
 * يملكه: أن يعرف أنّ العطب ليس منه، ومن يبلّغه، وبأيّ رمز.
 *
 * فتفصيل الإصلاح مكانه سجلّ الخادم، ويبقى للقارئ خبرٌ وطريق.
 */
const ERROR_TEXT: Record<string, string> = {
  AccessDenied:
    "هذا البريد ليس في قائمة المصرَّح لهم. اطلب من مالك الحساب إضافتك، ثمّ حاول ثانيةً.",
  Verification: "انتهت صلاحية رابط الدخول. اطلب رابطاً جديداً وحاول ثانيةً.",
  Configuration:
    "إعداد الدخول ناقصٌ عندنا لا عندك. أبلِغ مالك الحساب بهذه الشاشة — لا شيء تفعله من جهتك.",
  OAuthSignin: "تعذّر الاتصال بجوجل. المشكلة عندنا لا عندك — أبلِغ مالك الحساب.",
  OAuthCallback: "تعذّر إكمال الدخول مع جوجل. المشكلة عندنا لا عندك — أبلِغ مالك الحساب.",
  // يقع حين يوجد مستخدم بهذا البريد في قاعدة البيانات بلا حساب جوجل مرتبط
  OAuthAccountNotLinked:
    "هذا البريد مسجَّل عندنا لكنّه غير مرتبط بحساب جوجل. اطلب من مالك الحساب ربطه — لا يمكن إصلاحه من هذه الشاشة.",
  Callback: "توقّف الدخول بعد رجوعك من جوجل. حاول ثانيةً، فإن تكرّر فأبلِغ مالك الحساب.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; from?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/");

  const { error, from } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <h1 className="font-display text-3xl font-black leading-tight">فواتير ذا بوبليك هاوس</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">
        الدخول مقصور على فريق المؤسسة. سجّل بحساب جوجل الذي يملك صلاحية أرشيف الدرايف.
      </p>

      {error && (
        <div className="mt-6 rounded-xl border border-danger/40 bg-danger-bg px-4 py-3">
          <p className="text-sm leading-relaxed text-danger">
            {ERROR_TEXT[error] ?? "تعذّر تسجيل الدخول. حاول ثانيةً، فإن تكرّر فأبلِغ مالك الحساب."}
          </p>
          {/*
            الرمز يُعرَض كي يُنقَل: من يبلّغ لا يحفظ الجملة، ويحفظ كلمةً
            واحدة تدلّ المصلح على موضع العطب بلا تخمين.
          */}
          <p className="mt-1.5 text-xs text-ink-soft">
            رمز الخطأ: <span className="nums font-bold" dir="ltr">{error}</span>
          </p>
        </div>
      )}

      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: from || "/" });
        }}
        className="mt-8"
      >
        <button
          type="submit"
          className="w-full rounded-xl bg-inverse-surface px-5 py-3.5 text-sm font-bold text-inverse-ink transition-opacity hover:opacity-90"
        >
          الدخول بحساب جوجل
        </button>
      </form>

      <p className="mt-6 text-xs leading-relaxed text-muted">
        سيطلب جوجل صلاحية الوصول إلى الدرايف، لأنّ الرفع يتم بحسابك أنت لا بحساب
        مشترك — فيظهر في سجل نشاط الدرايف من رفع ماذا.
      </p>
    </main>
  );
}
