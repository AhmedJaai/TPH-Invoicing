import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";

const ERROR_TEXT: Record<string, string> = {
  AccessDenied: "هذا البريد غير مصرَّح له بالدخول. راجع أحمد لإضافتك إلى القائمة البيضاء.",
  Configuration: "إعدادات الدخول غير مكتملة. راجع متغيّرات جوجل في الخادم.",
  Verification: "انتهت صلاحية رابط الدخول. حاول مرة أخرى.",
  // يقع حين يوجد مستخدم بهذا البريد في قاعدة البيانات بلا حساب جوجل مرتبط
  OAuthAccountNotLinked:
    "هذا البريد مسجّل في النظام لكنه غير مرتبط بحساب جوجل. يلزم حذف سجلّه ثم إعادة المحاولة.",
  OAuthCallback: "تعذّر إكمال التفويض مع جوجل. تأكّد أنّ عنوان الرجوع مسجّل في بيانات الاعتماد.",
  OAuthSignin: "تعذّر بدء التفويض مع جوجل. راجع Client ID و Client Secret.",
  Callback: "تعذّر إكمال الدخول بعد رجوعك من جوجل.",
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
        <p className="mt-6 rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger">
          {ERROR_TEXT[error] ?? "تعذّر تسجيل الدخول. حاول مرة أخرى."}
        </p>
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
