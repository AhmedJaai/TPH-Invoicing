import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { BrandMark } from "@/components/icons";
import { buttonClass } from "@/components/ui-tokens";

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
    <main className="grid grid-cols-[minmax(0,1fr)] min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <title>الدخول · ذا بوبليك هاوس</title>
      {/* ── العلامة: إطارٌ داكن يقول ما هذا النظام قبل أن يُطلب الدخول ── */}
      <section className="relative hidden overflow-hidden bg-frame p-12 text-frame-ink lg:flex lg:flex-col">
        <div className="flex items-center gap-3">
          <BrandMark className="h-10 w-auto text-frame-accent" />
          <div>
            <p className="text-lg font-bold leading-tight">ذا بوبليك هاوس</p>
            <p className="text-xs text-frame-muted">المال والتشغيل</p>
          </div>
        </div>
        <div className="mt-auto max-w-md">
          <p className="font-display text-[2.6rem] font-black leading-[1.15]">
            كلُّ صباح: ماذا تحتاج أن تعرف، وماذا تفعل.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-frame-muted">
            {[
              "الفاتورة تُصوَّر فتُقرأ، ويعرضها عليك النظام قبل الحفظ.",
              "لمن تدين وكم ومنذ متى — من حساب كلّ مورّدٍ لا من فاتورةٍ فاتورة.",
              "كشفُ البنك يُطابَق، والشهرُ يُقفَل بمعادلته.",
            ].map((t) => (
              <li key={t} className="flex items-start gap-2.5">
                <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-frame-accent" />
                {t}
              </li>
            ))}
          </ul>
        </div>
        <span aria-hidden className="pointer-events-none absolute -bottom-40 -end-40 h-[28rem] w-[28rem] rounded-full bg-frame-accent/10 blur-3xl" />
      </section>

      <section className="flex flex-col justify-center px-6 py-16 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <BrandMark className="h-9 w-auto text-accent" />
            <p className="text-base font-bold">ذا بوبليك هاوس</p>
          </div>
          <h1 className="text-[1.9rem] font-extrabold leading-tight tracking-tight">أهلاً بعودتك</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            الدخول مقصور على فريق المؤسسة. سجّل بحساب جوجل الذي يملك صلاحية أرشيف الدرايف.
          </p>

          {error && (
            <div role="alert" className="mt-6 rounded-xl border border-danger/30 bg-danger-bg px-4 py-3">
              <p className="text-sm leading-relaxed text-danger">
                {ERROR_TEXT[error] ?? "تعذّر تسجيل الدخول. حاول ثانيةً، فإن تكرّر فأبلِغ مالك الحساب."}
              </p>
              {/* الرمز يُعرَض كي يُنقَل: من يبلّغ يحفظ كلمةً واحدة تدلّ المصلح على موضع العطب */}
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
            <button type="submit" className={`${buttonClass("primary", "lg")} w-full`}>
              <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
                <path fill="#fff" d="M21.35 11.1H12v2.9h5.35c-.23 1.5-1.73 4.4-5.35 4.4a5.9 5.9 0 0 1 0-11.8c1.8 0 3 .77 3.7 1.43l2.5-2.4A9.3 9.3 0 0 0 12 3a9 9 0 1 0 0 18c5.2 0 8.65-3.65 8.65-8.8 0-.6-.07-1.05-.15-1.5Z" />
              </svg>
              الدخول بحساب جوجل
            </button>
          </form>

          <p className="mt-6 text-xs leading-relaxed text-muted">
            سيطلب جوجل صلاحية الوصول إلى الدرايف، لأنّ الرفع يتم بحسابك أنت لا بحساب
            مشترك — فيظهر في سجلّ نشاط الدرايف من رفع ماذا.
          </p>
        </div>
      </section>
    </main>
  );
}
