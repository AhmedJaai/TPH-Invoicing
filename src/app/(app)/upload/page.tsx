import { MyUploads } from "@/components/my-uploads";
import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { FolderSync, Inbox, UsersRound } from "lucide-react";
import { db } from "@/db";
import { suppliers } from "@/db/schema";
import { Uploader } from "@/components/uploader";
import { PageShell } from "@/components/page-shell";
import { Callout, LinkButton, Section } from "@/components/ui";
import { TeamCaptures } from "@/components/team-captures";
import { listPendingCaptures } from "@/services/capture.service";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { inboxCount } from "@/lib/work";
import { DOCUMENT, countNoun } from "@/lib/arabic";
import { T } from "@/components/i18n/t";

export const dynamic = "force-dynamic";

/**
 * الرفع — شاشةُ الالتقاط.
 *
 * أوّلُها منطقةُ الالتقاط وحدها: على الجوّال زرُّ الكاميرا بعرض الشاشة،
 * وعلى الحاسوب منطقةُ إفلات. ثمّ ما رُفع في الجلسة بمراحله (يُقرأ ←
 * يُراجَع ← يُؤرشَف)، وبطاقةُ المراجعة بجانب الورقة.
 *
 * والدرايف طريقٌ ثانٍ إلى الشيء نفسه — يلتقط ما وصله من غير هذه الصفحة
 * ويجري وحده. كان قسماً أسفل هذه الصفحة فلم يُرَ مرّتين («ظنّ الزرّ حُذف»
 * ثمّ «ما أشوفها»)، فصار لساناً باسمه (`/documents/drive`) وهنا إشارةٌ إليه.
 */
export default async function UploadPage() {
  const user = await currentUser();
  if (!user) redirect("/login?from=/upload");

  const showAmounts = can(user.role, "amounts:view");
  const canDecide = can(user.role, "document:upload");

  const [rows, waiting] = await Promise.all([
    db
      .select({ id: suppliers.id, nameAr: suppliers.nameAr })
      .from(suppliers)
      .where(eq(suppliers.isActive, true))
      .orderBy(asc(suppliers.nameAr)),
    /* العددُ نفسُه الذي في شارة «المستندات» — لا عدٌّ ثانٍ بشرطٍ آخر */
    inboxCount().catch(() => null),
  ]);
  /* صورُ الفريق تنتظر من يقرّر — ومن لا يقرّر لا يراها */
  const team = canDecide ? await listPendingCaptures() : [];

  return (
    <PageShell
      user={user}
      width="page"
      title="ارفع مستنداً"
      intro="صوّر الفاتورة أو اختر ملفها كما وصلك. يقرأ النظام المورّد والرقم والتاريخ والمبالغ، ولا يُحفظ شيء حتى تؤكدها أنت."
    >
      {/* صورُ الفريق أوّلاً — من جاء من «يحتاج قرارك» جاء لها */}
      {team.length > 0 && (
        <Section
          id="team"
          className="mb-10"
          title="صوّرها الفريق، وتنتظرك"
          icon={UsersRound}
          count={team.length}
          hint="افتح كل صورة لتراجعها في القارئ تحت القائمة ثم تعتمدها، أو ارفضها بسبب يراه من صوّرها."
        >
          <TeamCaptures
            canSeeAmounts={showAmounts}
            items={team.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() }))}
          />
        </Section>
      )}

      <div id="reader" className="scroll-mt-24">
        <Uploader
          canSeeAmounts={showAmounts}
          canCreateSupplier={can(user.role, "supplier:edit")}
          suppliers={rows}
        />
      </div>

      {/* من يرفع يرى أين وقف ما رفعه اليوم — بلا مبالغ، فلا يسأل «هل وصل؟» */}
      <MyUploads userId={user.id} canOpen={can(user.role, "document:view")} />

      {waiting !== null && waiting > 0 && (
        <Callout
          tone="warn"
          icon={Inbox}
          className="mt-6"
          title={`${countNoun(waiting, DOCUMENT)} ${waiting <= 2 ? (waiting === 1 ? "ينتظر" : "ينتظران") : "تنتظر"} مراجعتك`}
          action={<LinkButton href="/documents?status=NEEDS_REVIEW" size="sm" variant="primary">راجعها</LinkButton>}
        >
          وصلت من الدرايف أو رفعتها من قبل، ولم يعتمدها النظام تلقائياً. سبب كل مستند في صفحة المستندات.
        </Callout>
      )}

      {!showAmounts && (
        <p className="mt-6 text-xs leading-relaxed text-muted">
          دورك لا يشمل الأرقام المالية. ارفع المستندات دون أن ترى مبالغها، ويؤكدها من يملك صلاحية رؤيتها.
        </p>
      )}

      {/* ── الدرايف: الطريقُ الثاني — حالُه وتحكّمُه في لسانه ── */}
      {canDecide && (
        <Callout
          tone="muted"
          icon={FolderSync}
          className="mt-12"
          title="وما يصل إلى الدرايف يقرؤه النظام تلقائياً"
          action={<LinkButton href="/documents/drive" size="sm" variant="secondary">حالة الدرايف</LinkButton>}
        >
          يفحص النظام الدرايف كل ثلاث ساعات، ويعيد تسمية ما أرشفه بالصيغة المعتمدة دون أن تفعل شيئاً. وإن وضعت فيه ملفاً بنفسك ولا تريد الانتظار، فافحصه الآن من تبويب «الدرايف».
        </Callout>
      )}
      {showAmounts && (
        <p className="mt-4 text-xs text-muted">
          <T s="لتراجع المورّدين وما عليك لكل منهم: {0}" a={[<Link key="0" href="/suppliers" className="font-bold text-accent hover:underline">حسابات المورّدين</Link>]} /></p>
      )}
    </PageShell>
  );
}
