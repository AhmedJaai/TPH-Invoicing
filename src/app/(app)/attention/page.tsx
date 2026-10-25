import { Suspense } from "react";
import { redirect } from "next/navigation";
import { CircleCheck } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { NoAccess } from "@/components/ui";
import { SectionBoundary } from "@/components/ui-client";
import { prioritize } from "@/lib/attention";
import { attentionItems, snoozedAttention } from "@/lib/work";
import { inLens, landing, parseLens } from "@/lib/attention-triage";
import { loadStartState } from "@/services/start.service";
import { DoublePaidWorkspace } from "@/components/double-paid-section";
import { FirstTransferWorkspace, IbanGuardWorkspace } from "@/components/iban-guard";
import { HandDuplicateWorkspace } from "@/components/hand-duplicate";
import { SnoozeControl } from "@/components/attention-snooze";
import { SnoozedList } from "@/components/attention-snoozed";
import { snoozeOptions } from "@/lib/attention-snooze";
import { todayInRiyadh } from "@/lib/riyadh-time";
import { ReviewSection } from "@/components/review-section";
import {
  ContractPolicyWorkspace, InboxWorkspace, StatementRequestWorkspace, UnbackedWorkspace,
} from "@/components/attention-workspaces";
import {
  AllClear, ItemDetail, KnowsNothing, LensEmpty, TriageList, TriageSummary, TriageTabs, WorkspaceSkeleton,
} from "@/components/attention-triage";
import { T } from "@/components/i18n/t";

export const dynamic = "force-dynamic";

/**
 * «يحتاج قرارك» — الموضع الوحيد للعمل الباقي، صندوقَ فرز.
 *
 * ── لماذا قائمةٌ وتفصيلٌ جنباً إلى جنب ──
 *
 * كانت الصفحة قائمةً واحدة من بطاقاتٍ طويلة، فلا يُرى منها على شاشةٍ
 * واحدة إلّا بندان، والزرُّ في كلٍّ منها يخرج بصاحب المقهى إلى صفحةٍ
 * أخرى فيفقد القائمة. فالقائمةُ على جهة والعملُ على الأخرى، ومن التفصيل
 * إلى البند التالي بلا رجوع.
 *
 * ── ولماذا العنوانُ ثابت ──
 *
 * كان العنوان «٨ بنود تنتظر قرارك» والهيكلُ «يحتاج قرارك» — فيتبدّل
 * أمام القارئ. فصار العنوانُ اسمَ الصفحة، والعددُ في الخلاصة تحته.
 *
 * والاختيار والتصفية في المسار (`?item=` · `?in=`) لا في حالة المتصفّح:
 * فالرابط يُشارَك، والرجوع يعمل، ولا يُجلَب شيءٌ من المتصفّح.
 */
export default async function AttentionPage({
  searchParams,
}: {
  searchParams: Promise<{ item?: string; in?: string; then?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login?from=/attention");
  if (!can(user.role, "reports:view")) {
    return (
      <PageShell user={user} title="يحتاج قرارك">
        <NoAccess />
      </PageShell>
    );
  }

  const [items, snoozed] = await Promise.all([attentionItems(user.role), snoozedAttention(user.role)]);
  const snoozedBlock = snoozed.length > 0 ? <SnoozedList snoozed={snoozed} canEdit={can(user.role, "bank:edit")} /> : null;
  const { top, rest } = prioritize(items, items.length);
  const ordered = [...top, ...rest];
  const params = await searchParams;
  const wanted = params.item;
  const wantedItem = ordered.find((i) => i.id === wanted);

  /*
    رابطُ بندٍ خارج عدسته (يدويٌّ أو قديم) لا يُفتح على قائمةٍ لا تحويه:
    تُترك العدسةُ ويُعرض الكلّ.
  */
  let lens = parseLens(params.in);
  if (wantedItem && !inLens(wantedItem, lens)) lens = "all";
  const list = ordered.filter((i) => inLens(i, lens));
  /* ما حُسم خرج — فالتالي كما كان حين فُتح، لا رأسُ القائمة */
  const { selected, resolved } = landing(list, wanted, params.then);

  /*
    على الحاسوب تُعرَض القائمة والتفصيل معاً. وعلى الجوّال لا يتّسعان:
    فمن اختار بنداً يرى بندَه وحده، وفوقه بابُ الرجوع والتنقّل.
  */
  const picked = Boolean(wantedItem) || resolved;

  const shell = (children: React.ReactNode) => (
    <PageShell
      user={user}
      width="wide"
      title="يحتاج قرارك"
      intro="كل ما ينتظر قرارك في مكان واحد، والأهم أولاً. لكل بند سببه وأثره والإجراء المطلوب منك."
    >
      {children}
    </PageShell>
  );

  if (items.length === 0) {
    /*
      «كلُّ ما يعرفه النظام سليم» عن نظامٍ لا يعرف شيئاً طمأنينةٌ بلا سند.
      فحين لا مستندَ ولا كشف يُقال ذلك، ويُدَلّ على البداية.
    */
    const start = await loadStartState();
    /* «لا شيء ينتظرك» والمؤجَّلُ قائم: يُقال تحته — لا طمأنينةَ تُخفي ما أُجِّل */
    return shell(<>{start.knowsNothing ? <KnowsNothing start={start} /> : <AllClear start={start} canPay={can(user.role, "payment:approve")} />}{snoozedBlock}</>);
  }

  const canEdit = can(user.role, "bank:edit");
  const canApprove = can(user.role, "payment:approve");
  const canUpload = can(user.role, "document:upload");
  const canEditSupplier = can(user.role, "supplier:edit");

  /*
    البنودُ التي تُحسم في مكانها — وما عداها يفتح سجلّاته، ولكلٍّ منها
    `href` مرشَّح في `attention.ts`، لا صفحةً عامّة. والقائمةُ نفسُها في
    `IN_PLACE_IDS` (يُعلَّم بها الصفّ «يُحسم هنا»).
  */
  const id = selected?.id;
  const workspace =
    id === "duplicate-payments" || id === "duplicate-payments-claimed" ? (
      <DoublePaidWorkspace canEdit={canEdit} />
    ) : id === "unclassified-bank" ? (
      <ReviewSection canApprove={canApprove} canEdit={canEdit} />
    ) : id === "unbacked-payments" ? (
      <UnbackedWorkspace canApprove={canApprove} canRequest={can(user.role, "supplier:edit")} />
    ) : id === "pending-documents" || id === "open-blockers" ? (
      <InboxWorkspace canUpload={canUpload} canConfirm={canUpload && can(user.role, "amounts:view")} />
    ) : id === "no-contract" ? (
      <ContractPolicyWorkspace canEdit={canEditSupplier} />
    ) : id === "missing-statements" ? (
      <StatementRequestWorkspace canEdit={canEditSupplier} />
    ) : id === "iban-mismatch" ? (
      <IbanGuardWorkspace canEdit={canEdit} />
    ) : id === "first-transfers" ? (
      <FirstTransferWorkspace canEdit={canEdit} />
    ) : id === "duplicate-hand-payments" ? (
      <HandDuplicateWorkspace canAct={can(user.role, "invoice:remove")} />
    ) : undefined;

  return shell(
    <>
      {/*
        على الجوّال من فتح بنداً يبدأ به: الخلاصةُ والألسنةُ فوقه كانت تدفع
        عنوانَه إلى الطيّ. وهما في القائمة التي يعود إليها بزرّ الرجوع.
      */}
      <div className={picked ? "hidden lg:block" : ""}>
        <TriageSummary items={items} />
        <div className="mt-5">
          <TriageTabs items={items} lens={lens} />
        </div>
      </div>

      {list.length === 0 || !selected ? (
        <div className="mt-5">
          <LensEmpty lens={lens} />
        </div>
      ) : (
        <div className={`grid gap-6 lg:mt-5 lg:grid-cols-[21rem_minmax(0,1fr)] lg:items-start 2xl:grid-cols-[24rem_minmax(0,1fr)] ${picked ? "" : "mt-5"}`}>
          <nav
            aria-label="البنود"
            className={`lg:sticky lg:top-20 lg:block lg:max-h-[calc(100vh-6.5rem)] lg:overflow-y-auto lg:pb-2 lg:pe-1 ${
              picked ? "hidden" : ""
            }`}
          >
            <TriageList items={list} lens={lens} selectedId={selected.id} />
          </nav>

          <div className={`min-w-0 lg:block ${picked || resolved ? "" : "hidden"}`}>
            {resolved && (
              <p role="status" className="mb-3 flex animate-rise items-center gap-2 rounded-xl border border-ok/25 bg-ok-bg px-4 py-2.5 text-xs font-bold text-ok">
                <T s="{0}تمّ البتّ في البند السابق وخرج من القائمة، وهذا هو البند التالي." a={[<CircleCheck key="0" className="h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden />]} /></p>
            )}
            <ItemDetail
              key={selected.id}
              item={selected}
              list={list}
              lens={lens}
              extraAction={canEdit ? <SnoozeControl itemId={selected.id} options={snoozeOptions(todayInRiyadh())} /> : undefined}
              workspace={
                workspace ? (
                  /* اللوحُ يُقرأ من القاعدة — لا ينتظره ما فوقه */
                  <SectionBoundary key={selected.id} what="تفاصيل هذا البند">
                    <Suspense fallback={<WorkspaceSkeleton />}>
                      {workspace}
                    </Suspense>
                  </SectionBoundary>
                ) : undefined
              }
            />
          </div>
        </div>
      )}
      {snoozedBlock}
    </>,
  );
}
