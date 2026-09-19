import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { Card, EmptyState, LinkButton, NoAccess, buttonClass } from "@/components/ui";
import {
  AREA_LABEL, IMPACT_LABEL, SEVERITY_LABEL, impactByKind, prioritize,
  type AttentionItem, type AttentionSeverity,
} from "@/lib/attention";
import { attentionItems } from "@/lib/work";
import { ITEM, countNoun } from "@/lib/arabic";
import { DoublePaidWorkspace } from "@/components/double-paid-section";
import { ReviewSection } from "@/components/review-section";

export const dynamic = "force-dynamic";

/**
 * «يحتاج قرارك» — الموضع الوحيد للعمل الباقي.
 *
 * ── لماذا قائمةٌ وتفصيلٌ جنباً إلى جنب ──
 *
 * كانت الصفحة قائمةً واحدة من بطاقاتٍ طويلة: كلُّ بندٍ يحمل عنوانه
 * وأثره وشرحه وخطوته وأدلّته وزرّه، فلا يُرى منها على شاشةٍ واحدة إلّا
 * بندان. ومن أراد أن يقارن «أيّهما أوّلاً؟» نزل وصعد.
 *
 * والزرُّ في كلٍّ منها يخرج بصاحب المقهى إلى صفحةٍ أخرى — فيفقد
 * القائمة، ويعود إليها من أوّلها. وذلك ثمنٌ لا داعيَ له على شاشةٍ
 * عرضُها ١٤٤٠ بكسلاً: القائمة على جهة والعمل على الأخرى.
 *
 * ── وأين وقع العمل ──
 *
 * بندان من السبعةَ عشر لهما ورشةٌ تفاعليّة كاملة، وكانت كلٌّ منهما في
 * صفحةٍ مستقلّة تعرض البند مرّةً ثانية:
 *
 *   • **«سُدّد مرّتين»** كان معروضاً كاملاً هنا وفي `/bank` — البند
 *     نفسه والمبالغ نفسها والأزرار نفسها في شاشتين.
 *   • **«حركات لم تُصنَّف»** كان زرُّه يفتح `/review` — صفحةً اسمُها
 *     «طابور المراجعة» وهي فارغة.
 *
 * فصارا لوحَ فعلٍ داخل البند نفسه. والاختيار في المسار (`?item=`) لا في
 * حالة المتصفّح: فالرابط يُشارَك، والرجوع يعمل، ولا يُجلَب شيءٌ من
 * المتصفّح.
 */

const STYLE: Record<AttentionSeverity, { rail: string; text: string; box: string }> = {
  CRITICAL: { rail: "bg-danger", text: "text-danger", box: "border-danger/40 bg-danger-bg" },
  HIGH: { rail: "bg-warn", text: "text-warn", box: "border-warn/40 bg-warn-bg" },
  MEDIUM: { rail: "bg-line-strong", text: "text-ink-soft", box: "border-line bg-raised" },
  OPPORTUNITY: { rail: "bg-ok", text: "text-ok", box: "border-ok/40 bg-ok-bg" },
};

/** صفٌّ في القائمة — ما يكفي للاختيار، لا أكثر. */
function Row({ item, active }: { item: AttentionItem; active: boolean }) {
  const s = STYLE[item.severity];
  return (
    <Link
      href={`/attention?item=${encodeURIComponent(item.id)}`}
      aria-current={active ? "true" : undefined}
      className={`relative block overflow-hidden rounded-xl border px-3.5 py-3 transition-colors ${
        active ? "border-ink bg-sunken" : "border-line bg-raised hover:bg-sunken/60"
      }`}
    >
      <span className={`absolute inset-y-0 start-0 w-1 ${s.rail}`} aria-hidden />
      <span className="block ps-1.5">
        <span className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 text-xs font-bold leading-snug">{item.title}</span>
          <span className={`shrink-0 text-[10px] font-bold ${s.text}`}>
            {SEVERITY_LABEL[item.severity]}
          </span>
        </span>
        <span className="mt-1 flex items-baseline justify-between gap-2">
          <span className="text-[11px] text-muted">{AREA_LABEL[item.area]}</span>
          {item.impact.amountMinor !== null && item.impact.amountMinor > 0 && (
            <span className="nums shrink-0 text-xs font-bold">
              <Money minor={item.impact.amountMinor} />
            </span>
          )}
        </span>
      </span>
    </Link>
  );
}

/** لوحُ التفصيل — ماذا · لماذا · الأثر · الفعل، ثمّ الفعل نفسه إن أمكن هنا. */
function Detail({
  item,
  workspace,
}: {
  item: AttentionItem;
  workspace?: React.ReactNode;
}) {
  const s = STYLE[item.severity];
  const { kind, amountMinor } = item.impact;

  return (
    <div className="space-y-4">
      <Card className={s.box}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="font-display text-xl font-bold leading-snug">{item.title}</h2>
          <span className={`shrink-0 text-[11px] font-bold ${s.text}`}>
            {SEVERITY_LABEL[item.severity]} · {AREA_LABEL[item.area]}
          </span>
        </div>

        {amountMinor !== null && amountMinor > 0 ? (
          <p className="mt-3 flex flex-wrap items-baseline gap-x-2.5">
            <span className="nums font-display text-3xl font-black leading-none">
              <Money minor={amountMinor} />
            </span>
            <span className="text-xs opacity-70">{IMPACT_LABEL[kind]}</span>
          </p>
        ) : (
          <p className="mt-3 text-xs font-bold opacity-70">{IMPACT_LABEL[kind]}</p>
        )}

        <p className="mt-3 text-sm leading-relaxed text-ink-soft">{item.detail}</p>
        <p className="mt-2.5 text-sm leading-relaxed">
          <span className="font-bold">الخطوة التالية: </span>
          {item.action}
        </p>

        {/*
          الزرُّ يخرج بالقارئ من هذه الشاشة — فلا يُعرَض حين يكون العملُ
          نفسُه معروضاً تحته. وكان يُعرَض دائماً، فيُدعى إلى صفحةٍ أخرى
          لفعلِ ما بين يديه.
        */}
        {!workspace && (
          <div className="mt-4">
            <Link href={item.href} className={buttonClass("primary", "sm")}>
              {item.actionLabel ?? "افتح السجلّات"} ←
            </Link>
          </div>
        )}
      </Card>

      {item.evidence.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-bold text-muted">
            ما بُني عليه هذا البند ({item.evidence.length})
          </h3>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-raised">
            {item.evidence.map((e, i) => (
              <li key={i} className="flex items-start justify-between gap-3 px-3.5 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium">{e.label}</span>
                  {e.sub && <span className="block truncate text-[11px] text-muted">{e.sub}</span>}
                </span>
                {e.amountMinor !== undefined && (
                  <span className="nums shrink-0 text-xs font-bold">
                    <Money minor={e.amountMinor} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {workspace && (
        <section>
          <h3 className="mb-2 text-xs font-bold text-muted">احسمها هنا</h3>
          {workspace}
        </section>
      )}
    </div>
  );
}

export default async function AttentionPage({
  searchParams,
}: {
  searchParams: Promise<{ item?: string }>;
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

  const items = await attentionItems();
  const { top, rest } = prioritize(items, items.length);
  const ordered = [...top, ...rest];

  const wanted = (await searchParams).item;
  const selected = ordered.find((i) => i.id === wanted) ?? ordered[0];
  /*
    على الحاسوب تُعرَض القائمة والتفصيل معاً. وعلى الجوّال لا يتّسع
    الاثنان: فلو عُرضا لوقع التفصيلُ تحت تسعة صفوف، فيضغط صاحبُ المقهى
    بنداً ولا يرى أثراً لضغطته. فمن اختار بنداً يرى بندَه وحده، وفوقه
    بابُ الرجوع إلى القائمة.
  */
  const picked = Boolean(wanted) && ordered.some((i) => i.id === wanted);

  const impact = impactByKind(items);
  const money = (["RECOVERABLE", "AT_RISK", "OWED", "UNATTRIBUTED"] as const)
    .map((kind) => ({ kind, ...(impact[kind] ?? { amountMinor: 0, count: 0 }) }))
    .filter((x) => x.amountMinor > 0);

  if (items.length === 0) {
    return (
      <PageShell
        user={user}
        width="wide"
        title="يحتاج قرارك"
        intro="كلُّ ما ينتظر قراراً في مكانٍ واحد — ولكلٍّ منه سببُه وفعلُه."
      >
        <EmptyState
          title="لا شيء يحتاج قرارك."
          hint="كلُّ ما يعرفه النظام سليم: لا مالٌ خرج مرّتين، ولا دفعةٌ بلا مستند، ولا مستندٌ ينتظر."
          action={<LinkButton href="/suppliers">افتح حسابات المورّدين</LinkButton>}
        />
      </PageShell>
    );
  }

  const canEdit = can(user.role, "bank:edit");
  const canApprove = can(user.role, "payment:approve");

  /*
    البندان اللذان يُحسمان في مكانهما. وما عداهما يفتح سجلّاته — ولكلٍّ
    منها `href` مرشَّح في `attention.ts`، لا صفحةً عامّة.
  */
  const workspace =
    selected.id === "duplicate-payments" || selected.id === "duplicate-payments-claimed" ? (
      <DoublePaidWorkspace canEdit={canEdit} />
    ) : selected.id === "unclassified-bank" ? (
      <ReviewSection canApprove={canApprove} canEdit={canEdit} />
    ) : undefined;

  return (
    <PageShell
      user={user}
      width="wide"
      title="يحتاج قرارك"
      intro="كلُّ ما ينتظر قراراً في مكانٍ واحد — ولكلٍّ منه سببُه وفعلُه."
    >
      {money.length > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {money.map((m) => (
            <div key={m.kind} className="rounded-xl border border-line bg-raised px-3.5 py-2.5 shadow-raised">
              <p className="text-[11px] text-muted">{IMPACT_LABEL[m.kind]}</p>
              <p className="nums mt-1 font-display text-lg font-bold leading-none">
                <Money minor={m.amountMinor} />
              </p>
              <p className="mt-1 text-[11px] text-muted">{countNoun(m.count, ITEM)}</p>
            </div>
          ))}
        </div>
      )}
      <p className="mb-5 max-w-3xl text-xs leading-relaxed text-muted">
        والمبالغ أعلاه لا تُجمع بعضها إلى بعض: ريالٌ قد يُسترد ليس كريالٍ معرَّض للرفض وليس
        كريالٍ مستحقّ عليك.
      </p>

      {/* ── القائمة والتفصيل ── */}
      <div className="grid gap-5 lg:grid-cols-[19rem_minmax(0,1fr)] lg:items-start">
        <nav
          aria-label="البنود"
          className={`space-y-2 lg:sticky lg:top-20 lg:block lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pe-1 ${
            picked ? "hidden" : ""
          }`}
        >
          <p className="px-1 text-[11px] font-bold text-muted">
            {countNoun(items.length, ITEM)} — الأهمّ أوّلاً
          </p>
          {ordered.map((i) => (
            <Row key={i.id} item={i} active={i.id === selected.id} />
          ))}
        </nav>

        <div className={`min-w-0 lg:block ${picked ? "" : "hidden"}`}>
          {picked && (
            <Link
              href="/attention"
              className="mb-3 inline-flex min-h-11 items-center text-xs font-medium text-muted underline underline-offset-4 lg:hidden"
            >
              → كلّ البنود ({items.length})
            </Link>
          )}
          <Detail item={selected} workspace={workspace} />
        </div>
      </div>
    </PageShell>
  );
}
