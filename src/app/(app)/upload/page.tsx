import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { FolderSync, Inbox } from "lucide-react";
import { db } from "@/db";
import { suppliers } from "@/db/schema";
import { Uploader } from "@/components/uploader";
import { PageShell } from "@/components/page-shell";
import { DriveSync } from "@/components/drive-sync";
import { DriveRename } from "@/components/drive-rename";
import { Callout, LinkButton, Section } from "@/components/ui";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { inboxCount } from "@/lib/work";
import { DOCUMENT, countNoun } from "@/lib/arabic";

export const dynamic = "force-dynamic";

/**
 * الرفع — شاشةُ الالتقاط.
 *
 * أوّلُها منطقةُ الالتقاط وحدها: على الجوّال زرُّ الكاميرا بعرض الشاشة،
 * وعلى الحاسوب منطقةُ إفلات. ثمّ ما رُفع في الجلسة بمراحله (يُقرأ ←
 * يُراجَع ← يُؤرشَف)، وبطاقةُ المراجعة بجانب الورقة.
 *
 * والدرايف طريقٌ ثانٍ إلى الشيء نفسه — يلتقط ما وصله من غير هذه الصفحة،
 * ويجري وحده كلَّ ثلاث ساعات — فموضعُه تحت الرفع قسماً ثانوياً، ظاهراً
 * لا مطويّاً: **الفعل الذي لا يُرى غيرُ موجود** (ظنّ صاحبُ العمل مرّةً
 * أنّ زرّ المزامنة حُذف لأنّه طُوي).
 */
export default async function UploadPage() {
  const user = await currentUser();
  if (!user) redirect("/login?from=/upload");

  const showAmounts = can(user.role, "amounts:view");

  const [rows, waiting] = await Promise.all([
    db
      .select({ id: suppliers.id, nameAr: suppliers.nameAr })
      .from(suppliers)
      .where(eq(suppliers.isActive, true))
      .orderBy(asc(suppliers.nameAr)),
    /* العددُ نفسُه الذي في شارة «المستندات» — لا عدٌّ ثانٍ بشرطٍ آخر */
    inboxCount().catch(() => null),
  ]);

  return (
    <PageShell
      user={user}
      width="page"
      title="ارفع مستنداً"
      intro="صوّر الفاتورة أو اختر ملفّها كما وصلك — يقرأ النظامُ المورّدَ والرقمَ والتاريخَ والمبالغ، وتؤكّدها أنت قبل أن يُحفَظ شيء."
    >
      <Uploader
        canSeeAmounts={showAmounts}
        canCreateSupplier={can(user.role, "supplier:edit")}
        suppliers={rows}
      />

      {waiting !== null && waiting > 0 && (
        <Callout
          tone="warn"
          icon={Inbox}
          className="mt-6"
          title={`${countNoun(waiting, DOCUMENT)} ${waiting <= 2 ? (waiting === 1 ? "ينتظر" : "ينتظران") : "تنتظر"} مراجعتك`}
          action={<LinkButton href="/documents?status=NEEDS_REVIEW" size="sm" variant="primary">راجعها</LinkButton>}
        >
          وصلت من الدرايف أو رُفعت قبلُ ولم تدخل وحدها — لكلٍّ سببُه في المستندات.
        </Callout>
      )}

      {!showAmounts && (
        <p className="mt-6 text-xs leading-relaxed text-muted">
          دورك لا يشمل الأرقام المالية — تُرفع المستندات وتُقرأ دون مبالغها، ويؤكّدها من يراها.
        </p>
      )}

      {/* ── الدرايف: الطريقُ الثاني ── */}
      <Section
        id="drive"
        icon={FolderSync}
        title="من الدرايف"
        hint="المزامنةُ تجري وحدها كلَّ ثلاث ساعات. افحص الآن إن وضعتَ ملفّاً في الدرايف بيدك ولا تريد الانتظار."
        className="mt-12"
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <DriveSync />
          <DriveRename />
        </div>
        {showAmounts && (
          <p className="mt-4 text-xs text-muted">
            ولمراجعة المورّدين وما عليك لكلٍّ منهم:{" "}
            <Link href="/suppliers" className="font-bold text-accent hover:underline">حسابات المورّدين</Link>
          </p>
        )}
      </Section>
    </PageShell>
  );
}
