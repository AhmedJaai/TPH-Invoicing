import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { suppliers } from "@/db/schema";
import { Uploader } from "@/components/uploader";
import { PageShell } from "@/components/page-shell";
import { DriveSync } from "@/components/drive-sync";
import { DriveRename } from "@/components/drive-rename";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await currentUser();
  if (!user) redirect("/login?from=/upload");

  const showAmounts = can(user.role, "amounts:view");

  const rows = await db
    .select({
      id: suppliers.id,
      nameAr: suppliers.nameAr,
    })
    .from(suppliers)
    .where(eq(suppliers.isActive, true))
    .orderBy(asc(suppliers.nameAr));

  return (
    <PageShell
      user={user}
      width="form"
      title="ارفع مستنداً"
      intro="ارفع الفاتورة كما وصلتك من واتساب — باسمها العشوائي أو صورةً بجوّالك. يقرأ النظام المستند نفسه، ويستخرج المورّد والرقم والتاريخ والمبالغ، ويعرض كل ذلك للتعديل قبل أن يُحفظ شيء."
    >
      <div>
        <Uploader
          canSeeAmounts={showAmounts}
          canCreateSupplier={can(user.role, "supplier:edit")}
          suppliers={rows.map((s) => ({ id: s.id, nameAr: s.nameAr }))}
        />
      </div>

      {/*
        ما تحت منطقة الرفع كان جردَ نظام: زرّا صيانة، ثمّ اسم النموذج
        القارئ، ثمّ اثنان وعشرون مورّداً بأسماء مجلّداتهم اللاتينية.
        فصفحةُ المهمّة اليومية أكثرُها ليس المهمّة. وقد طُوي ذلك كلُّه
        خلف تفصيلٍ يُفتَح عند الحاجة، وبقي فوقَه ما يخصّ الرفع وحده.
      */}
      {/*
        مزامنة الدرايف فعلٌ يوميّ لا حالةُ نظام.

        كانت مطويّةً داخل «حالة النظام والمورّدون المسجّلون» بعد جولة
        تحسين الواجهة، فظنّ صاحب العمل أنّ الزرّ حُذف — وبحث عنه.
        **والفعل الذي لا يُرى غيرُ موجود**، مهما كان مكتوباً في الشيفرة.

        وموضعُه هنا: تحت الرفع مباشرةً، لأنّه الطريق الثاني إلى الشيء
        نفسه — الرفع يدخل ملفّاً واحداً، والمزامنة تلتقط ما وصل الدرايف
        من غير هذه الصفحة.
      */}
      <section className="mt-10 rounded-2xl border border-line bg-raised p-4 shadow-raised">
        <h2 className="mb-1 text-sm font-bold">افحص الدرايف</h2>
        <p className="mb-4 text-sm text-muted">
          تبحث في درايف عن ملفّات لم تُسجَّل بعد، فتقرأها وتقيّدها وتقترح توحيد أسمائها.
        </p>
        <div className="flex flex-wrap items-start gap-3">
          <DriveSync />
          <DriveRename />
        </div>
      </section>

      {/*
        ── ما حُذف من هنا وأين صار ──

        كان تحت الرفع لوحٌ اسمُه «حالة النظام والمورّدون المسجّلون» فيه:

          • **«قارئ الفواتير: deepseek»** — اسمُ نموذجٍ لا شأن لصاحب
            المقهى به، ولا فعلَ له عليه. موضعُه الإعدادات.
          • **«يحتاجون عقد توريد: ٣»** — وكان يعدّ `!issuesInvoices`
            وحده، فيتجاهل الهجرة ٠٣٥: من أُعلن أنّه لا يُطلَب منه عقد،
            ومن فواتيرُه ورقيّة، ومن عقدُه عندنا. فتقول صفحةُ المورّدين
            و«يحتاج قرارك» **٢** ويقول هذا **٣**. وعددٌ ثالثٌ لسؤالٍ
            مجابٍ في موضعين ليس معلومةً زائدة، هو نقضُ الاثنين.
          • **٢٢ مورّداً بأسماء مجلّداتهم اللاتينية** — جردٌ مكانُه
            «حسابات المورّدين»، وهي تعرضهم بما عليهم لا بأسمائهم
            البرمجيّة.

        فبقي في صفحة الرفع ما يخصّ الرفع: منطقةُ الملفّ، ومزامنةُ
        الدرايف، ومدخلٌ إلى المورّدين لمن أراد أن يراجعهم.
      */}
      {/* مدخلٌ إلى ما يُفتَح لقارئه وحده — مديرُ المشتريات لا يرى حسابات المورّدين */}
      {showAmounts && (
        <p className="mt-6 text-xs leading-relaxed text-muted">
          ولمراجعة المورّدين وما عليك لكلٍّ منهم:{" "}
          <Link href="/suppliers" className="font-medium underline underline-offset-4 hover:text-ink">
            حسابات المورّدين
          </Link>
          .
        </p>
      )}

      {!showAmounts && (
        <footer className="mt-12 border-t border-line pt-5 text-xs leading-relaxed text-muted">
          دورك لا يشمل الأرقام المالية — تظهر لك المستندات دون مبالغها.
        </footer>
      )}

    </PageShell>
  );
}
