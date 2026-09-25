import Link from "next/link";
import {
  Activity, ArrowDown, ArrowLeft, Ban, CalendarClock, ChevronDown, ChevronLeft, ChevronRight, CircleAlert,
  CircleCheck, CircleDot, CircleHelp, Clock, Copy, FileClock, FileSearch, FileSignature, FileText, FileWarning,
  Hourglass, Info, Landmark, Lightbulb, ListChecks, type LucideIcon, Percent, ReceiptText, RotateCcw, Scale,
  ScanSearch, ShieldAlert, Sparkles, TrendingUp, TriangleAlert, Undo2, Unlink, Zap,
} from "lucide-react";
import { Money, Prose } from "./money";
import { Badge, LinkButton, LinkTabs, Stepper, buttonClass, type Tone } from "./ui";
import {
  AREA_LABEL, IMPACT_LABEL, SEVERITY_LABEL, countBySeverity,
  type AttentionEvidence, type AttentionItem, type AttentionSeverity, type ImpactKind,
} from "@/lib/attention";
import {
  groupBySeverity, isKnownId, isSignal, itemHref, lensHref, lensTabs, neighbours, resolvesInPlace, stakeByKind,
  type AttentionId, type Lens, type Stake,
} from "@/lib/attention-triage";
import { ITEM, countNoun, nounForm } from "@/lib/arabic";
import type { StartState } from "@/lib/start";

/**
 * «يحتاج قرارك» — صندوقُ فرزٍ لا قائمةُ تنبيهات.
 *
 * ثلاثُ طبقات، كلٌّ تجيب سؤالاً:
 *
 *   ١. **كم، وبكم؟** — العددُ الواحد (هو عدّادُ الشريط نفسه) والمالُ
 *      المعلَّق بحسب نوعه، سطراً واحداً لا أربعَ بطاقات: كانت البطاقاتُ
 *      تدفع الطابور تحت الطيّ وتُقرأ مجموعاً.
 *   ٢. **أيُّها أوّلاً؟** — القائمةُ بالشدّة، والإشارةُ (مالٌ جرى على غير
 *      المعتاد) تُقرأ خبراً بجملته وفعلِه، والعملُ الترتيبيّ سطراً.
 *   ٣. **ماذا أفعل به؟** — التفصيلُ: لماذا ظهر، وأثرُه، وما المطلوب، ثمّ
 *      الفعلُ نفسُه في مكانه حيث أمكن. ومنه إلى البند التالي بلا رجوع.
 *
 * والاختيارُ والتصفيةُ في العنوان (`?item=` · `?in=`) لا في حالة المتصفّح:
 * الرابطُ يُشارَك، والرجوعُ يعمل، وJ/K وEnter تتنقّل بين الصفوف.
 */

/* ─────────────────────────── الرموز ─────────────────────────── */

const SEVERITY: Record<AttentionSeverity, { icon: LucideIcon; chip: string; text: string; tone: Tone }> = {
  CRITICAL: { icon: CircleAlert, chip: "bg-danger-bg text-danger", text: "text-danger", tone: "danger" },
  HIGH: { icon: TriangleAlert, chip: "bg-warn-bg text-warn", text: "text-warn", tone: "warn" },
  MEDIUM: { icon: Info, chip: "bg-info-bg text-info", text: "text-info", tone: "info" },
  OPPORTUNITY: { icon: Lightbulb, chip: "bg-ok-bg text-ok", text: "text-ok", tone: "ok" },
};

const SEVERITY_ORDER: AttentionSeverity[] = ["CRITICAL", "HIGH", "MEDIUM", "OPPORTUNITY"];

/** رمزُ كلّ بند — يُعرَف البندُ بشكله قبل أن يُقرأ عنوانه. */
const GLYPH: Record<AttentionId, LucideIcon> = {
  "bank-coverage-gap": CalendarClock,
  "bank-stale": CalendarClock,
  "bank-balance-difference": Scale,
  "duplicate-expenses": Copy,
  "duplicate-payments": Copy,
  "duplicate-payments-claimed": Hourglass,
  "unbacked-payments": ReceiptText,
  "open-blockers": Ban,
  "vat-at-risk": Percent,
  "overdue": Clock,
  "unclassified-bank": Landmark,
  "price-rises": TrendingUp,
  "lifecycle-anomalies": Unlink,
  "bounced-payments": Undo2,
  "missing-statements": FileClock,
  "unknown-tax": FileSearch,
  "no-lines": FileWarning,
  "pending-documents": FileText,
  "no-contract": FileSignature,
};

function ItemGlyph({ id, className, strokeWidth = 2 }: { id: string; className: string; strokeWidth?: number }) {
  const Icon = isKnownId(id) ? GLYPH[id] : CircleDot;
  return <Icon className={className} strokeWidth={strokeWidth} aria-hidden />;
}

/** رمزُ الأثر، ثمّ جملتُه حين يُعرف قدرُه وحين لا يُعرف — فلا تقول «مبلغٌ معلوم» فوق «غير معروف». */
const IMPACT: Record<ImpactKind, { icon: LucideIcon; text: string; hint: string; unknownHint: string }> = {
  RECOVERABLE: {
    icon: RotateCcw, text: "text-ok",
    hint: "مالٌ خرج وقد يعود إن طولبت به.",
    unknownHint: "قد يعود مالٌ، وقدرُه لم يُحسَب بعد.",
  },
  AT_RISK: {
    icon: ShieldAlert, text: "text-danger",
    hint: "مالٌ قد يضيع إن لم يُعالَج.",
    unknownHint: "قد يضيع مالٌ لا يُعرف قدرُه حتى يُقرأ ما وراءه.",
  },
  OWED: {
    icon: Clock, text: "text-warn",
    hint: "مستحقٌّ عليك للمورّدين — لا مالٌ يضيع.",
    unknownHint: "مستحقٌّ عليك لم يُعرف قدرُه بعد.",
  },
  UNATTRIBUTED: {
    icon: CircleHelp, text: "text-info",
    hint: "مبلغٌ معلوم لم يُنسب إلى وجهه بعد.",
    unknownHint: "ينقص أرقامَك بقدرٍ لا يُعرف حتى يصل ما غاب.",
  },
  ANNUAL: {
    icon: TrendingUp, text: "text-plum",
    hint: "تقديرٌ على سنةٍ قادمة، لا مالٌ خرج.",
    unknownHint: "أثرٌ سنويّ لم يُقدَّر بعد.",
  },
  BLOCKED: {
    icon: Ban, text: "text-muted",
    hint: "مبلغُ ما يوقفه — لا مالٌ خرج.",
    unknownHint: "لا مالَ فيه، لكنّه يوقف عملاً غيره.",
  },
};

/* ─────────────────────────── الخلاصة ─────────────────────────── */

function waitingPhrase(n: number): string {
  if (n === 1) return "بندٌ واحد ينتظر قرارك";
  if (n === 2) return "بندان ينتظران قرارك";
  return `${nounForm(n, ITEM)} تنتظر قرارك`;
}

/**
 * العددُ الواحد والمالُ المعلَّق — سطرٌ لا لوحة.
 *
 * العددُ هو `attentionItems().length` كما يعدّه الشريط. والمالُ لكلّ نوعٍ
 * وحده، والمجهولُ «غير معروف» لا صفر.
 */
export function TriageSummary({ items }: { items: readonly AttentionItem[] }) {
  const bySeverity = countBySeverity(items);
  const stakes = stakeByKind(items);
  return (
    <section
      aria-label="خلاصة ما ينتظر"
      className="animate-rise rounded-2xl border border-line bg-raised shadow-raised"
    >
      <div className="flex flex-col gap-4 p-4 sm:p-5 xl:flex-row xl:items-center xl:gap-0">
        <div className="flex items-center gap-4 xl:w-72 xl:shrink-0 xl:pe-6">
          <span className="nums text-[2.9rem] font-black leading-none tracking-tight">{items.length}</span>
          <div className="min-w-0">
            <p className="text-sm font-bold leading-snug">{waitingPhrase(items.length)}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-bold">
              {SEVERITY_ORDER
                .filter((s) => bySeverity[s] > 0)
                .map((s) => {
                  const Icon = SEVERITY[s].icon;
                  return (
                    <span key={s} className={`inline-flex items-center gap-1 ${SEVERITY[s].text}`}>
                      <Icon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                      <span className="nums">{bySeverity[s]}</span> {SEVERITY_LABEL[s]}
                    </span>
                  );
                })}
            </p>
          </div>
        </div>

        {stakes.length > 0 && (
          <div className="min-w-0 flex-1 border-t border-line-soft pt-4 xl:border-t-0 xl:border-s xl:ps-6 xl:pt-0">
            <p className="mb-2.5 text-[11px] font-medium text-muted">
              المالُ المعلَّق بها — كلُّ نوعٍ وحده، ولا يُجمع نوعٌ إلى نوع
            </p>
            <dl className="grid grid-cols-2 gap-x-5 gap-y-3.5 sm:grid-cols-3 xl:flex xl:flex-wrap xl:gap-x-8">
              {stakes.map((s) => (
                <StakeFigure key={s.kind} stake={s} />
              ))}
            </dl>
          </div>
        )}
      </div>
    </section>
  );
}

function StakeFigure({ stake: s }: { stake: Stake }) {
  const Icon = IMPACT[s.kind].icon;
  const allUnknown = s.unknown === s.items;
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-[11px] font-bold text-ink-soft">
        <Icon className={`h-3.5 w-3.5 shrink-0 ${IMPACT[s.kind].text}`} strokeWidth={2} aria-hidden />
        {IMPACT_LABEL[s.kind]}
      </dt>
      <dd className="mt-1 text-[1.05rem] font-bold leading-tight">
        {!allUnknown ? (
          <Money minor={s.knownMinor} />
        ) : s.kind === "BLOCKED" ? (
          <span className="text-[13px]">بلا مبلغ</span>
        ) : (
          <span className="text-[13px] text-muted">غير معروف</span>
        )}
      </dd>
      <dd className="mt-0.5 text-[11px] text-muted">
        {countNoun(s.items, ITEM)}
        {!allUnknown && s.unknown > 0 && " · وبعضُها لم يُقدَّر"}
      </dd>
    </div>
  );
}

/** ألسنةُ التصفية — في العنوان، فتُحفَظ وتُشارَك. */
export function TriageTabs({ items, lens }: { items: readonly AttentionItem[]; lens: Lens }) {
  return (
    <LinkTabs
      label="صفِّ البنود"
      items={lensTabs(items).map((t) => ({
        href: lensHref(t.lens),
        label: t.label,
        count: t.count,
        active: t.lens === lens,
      }))}
    />
  );
}

/* ─────────────────────────── القائمة ─────────────────────────── */

export function TriageList({
  items,
  lens,
  selectedId,
}: {
  items: readonly AttentionItem[];
  lens: Lens;
  selectedId: string | null;
}) {
  return (
    <div className="space-y-4">
      {groupBySeverity(items).map((g) => {
        const s = SEVERITY[g.severity];
        const Icon = s.icon;
        return (
          <section key={g.severity} aria-label={SEVERITY_LABEL[g.severity]}>
            <h2 className={`mb-1.5 flex items-center gap-1.5 px-1 text-[11px] font-bold ${s.text}`}>
              <Icon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              {SEVERITY_LABEL[g.severity]}
              <span className="nums font-medium text-muted">{g.items.length}</span>
            </h2>
            <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
              {g.items.map((i) => (
                <TriageRow key={i.id} item={i} lens={lens} active={i.id === selectedId} />
              ))}
            </ul>
          </section>
        );
      })}
      <p className="hidden px-1 text-[11px] text-muted lg:block">
        تنقّل بـ<kbd className="rounded border border-line px-1">J</kbd> و<kbd className="rounded border border-line px-1">K</kbd>،
        وافتح بـ<kbd className="rounded border border-line px-1">Enter</kbd>.
      </p>
    </div>
  );
}

/**
 * صفُّ بند. الإشارةُ تُقرأ خبراً: عنوانُها وجملتُها وفعلُها بضغطةٍ واحدة.
 * والعملُ الترتيبيّ سطرٌ: عنوانُه وبابُه وأثرُه.
 *
 * والرابطُ طبقةٌ تحت المحتوى لا غلاف — فزرُّ الفعل داخل الصفّ لا يصير
 * `<a>` داخل `<a>` فيسقط الترطيب (`.card-rows`).
 */
function TriageRow({ item, lens, active }: { item: AttentionItem; lens: Lens; active: boolean }) {
  const href = itemHref(item.id, lens);
  const s = SEVERITY[item.severity];
  const signal = isSignal(item);
  const inPlace = resolvesInPlace(item);
  const { amountMinor, kind } = item.impact;

  return (
    <li
      data-nav-item=""
      data-href={href}
      className={`card-rows group relative flex gap-3 px-3.5 py-3 transition-colors ${
        active ? "bg-accent-soft/70" : "hover:bg-hover"
      }`}
    >
      {active && <span aria-hidden className="absolute inset-y-2 start-0 w-[3px] rounded-e-full bg-accent" />}
      <Link href={href} aria-label="افتح التفصيل" tabIndex={-1} className="absolute inset-0" />

      <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${s.chip}`}>
        <ItemGlyph id={item.id} className="h-4 w-4" />
        <span className="sr-only">{SEVERITY_LABEL[item.severity]}</span>
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <Link
            href={href}
            aria-current={active ? "true" : undefined}
            className={`line-clamp-2 text-[13px] font-bold leading-snug hover:text-accent ${active ? "text-ink" : ""}`}
          >
            {item.title}
          </Link>
          {amountMinor !== null && amountMinor > 0 && (
            <span className="shrink-0 pt-px text-[13px] font-bold">
              <Money minor={amountMinor} />
            </span>
          )}
        </div>

        {signal && (
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink-soft">
            <Prose text={item.detail} />
          </p>
        )}

        <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted">
          <span>{AREA_LABEL[item.area]}</span>
          <span aria-hidden>·</span>
          <span>{IMPACT_LABEL[kind]}</span>
          {signal && (
            <span className="inline-flex items-center gap-1 rounded-full bg-plum-bg px-1.5 font-bold text-plum">
              <Activity className="h-3 w-3" strokeWidth={2.25} aria-hidden />
              إشارة
            </span>
          )}
          {inPlace && (
            <span className="inline-flex items-center gap-1 font-bold text-accent">
              <Zap className="h-3 w-3" strokeWidth={2.25} aria-hidden />
              يُحسم هنا
            </span>
          )}
        </p>

        {/* فعلُ الإشارة بضغطةٍ واحدة — وما يُحسم هنا فعلُه الصفُّ نفسه */}
        {signal && !inPlace && (
          <Link href={item.href} className={`${buttonClass("subtle", "sm")} mt-2`}>
            {item.actionLabel ?? "افتح السجلّات"}
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          </Link>
        )}
      </div>
    </li>
  );
}

/* ─────────────────────────── التفصيل ─────────────────────────── */

/** كم دليلاً يُعرَض قبل «اعرض الباقي». */
const EVIDENCE_SHOWN = 5;

export function ItemDetail({
  item,
  list,
  lens,
  workspace,
}: {
  item: AttentionItem;
  /** القائمةُ المعروضة (بعد التصفية) — منها السابقُ والتالي. */
  list: readonly AttentionItem[];
  lens: Lens;
  workspace?: React.ReactNode;
}) {
  const s = SEVERITY[item.severity];
  const { kind, amountMinor } = item.impact;
  const ImpactIcon = IMPACT[kind].icon;
  const nav = neighbours(list, item.id);
  /* رابطُ السجلّات الكاملة حين يكون العملُ هنا — إلّا إن كان الرابطُ هذه الصفحةَ نفسها */
  const outward = !item.href.startsWith("/attention");

  return (
    <article aria-labelledby="item-title" className="space-y-5">
      <div className="flex items-center justify-between gap-3 lg:hidden">
        <Link
          href={lensHref(lens)}
          className="inline-flex min-h-11 items-center gap-1 text-xs font-bold text-ink-soft hover:text-accent"
        >
          <ChevronRight className="h-4 w-4" strokeWidth={2} aria-hidden />
          كلُّ البنود
          <span className="nums font-medium text-muted">({list.length})</span>
        </Link>
        <Pager nav={nav} total={list.length} lens={lens} />
      </div>

      <header className="overflow-hidden rounded-2xl border border-line bg-raised shadow-raised">
        <div className="p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={s.tone} dot>{SEVERITY_LABEL[item.severity]}</Badge>
              <Badge>{AREA_LABEL[item.area]}</Badge>
              {isSignal(item) && (
                <span className="inline-flex items-center gap-1 rounded-full border border-plum/25 bg-plum-bg px-2 py-0.5 text-[11px] font-bold leading-5 text-plum">
                  <Activity className="h-3 w-3" strokeWidth={2.25} aria-hidden />
                  إشارةٌ في المال
                </span>
              )}
            </div>
            <div className="hidden lg:block">
              <Pager nav={nav} total={list.length} lens={lens} />
            </div>
          </div>

          <div className="mt-4 flex items-start gap-3.5">
            <span className={`hidden h-11 w-11 shrink-0 place-items-center rounded-xl sm:grid ${s.chip}`}>
              <ItemGlyph id={item.id} className="h-5 w-5" strokeWidth={1.9} />
            </span>
            <h2 id="item-title" className="min-w-0 text-xl font-bold leading-snug tracking-tight sm:pt-1.5 sm:text-[1.4rem]">
              {item.title}
            </h2>
          </div>

          {/* ── الأثر: الرقمُ أوّلاً ونوعُه تحته، والمجهولُ يُقال مجهولاً ── */}
          <div className="mt-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 rounded-xl bg-sunken/70 px-4 py-3.5">
            <div>
              <p className="flex items-center gap-1.5 text-[11px] font-bold text-ink-soft">
                <ImpactIcon className={`h-3.5 w-3.5 ${IMPACT[kind].text}`} strokeWidth={2} aria-hidden />
                {IMPACT_LABEL[kind]}
              </p>
              <p className="mt-1.5 leading-none">
                {amountMinor !== null ? (
                  <span className="text-[1.9rem] font-bold tracking-tight">
                    <Money minor={amountMinor} currency />
                  </span>
                ) : (
                  <span className="text-base font-bold text-ink-soft">
                    {kind === "BLOCKED" ? "بلا مبلغ" : "قدرُه غير معروف"}
                  </span>
                )}
              </p>
            </div>
            <p className="max-w-xs text-xs leading-relaxed text-muted">
              {amountMinor !== null ? IMPACT[kind].hint : IMPACT[kind].unknownHint}
            </p>
          </div>

          <div className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-4 md:grid-cols-2">
            <div>
              <h3 className="flex items-center gap-1.5 text-[11px] font-bold text-muted">
                <ScanSearch className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                لماذا ظهر
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-soft"><Prose text={item.detail} /></p>
            </div>
            <div>
              <h3 className="flex items-center gap-1.5 text-[11px] font-bold text-muted">
                <ListChecks className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                ما المطلوب
              </h3>
              <p className="mt-1.5 text-sm font-medium leading-relaxed"><Prose text={item.action} /></p>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line-soft pt-4">
            {workspace ? (
              <>
                <a href="#resolve" className={buttonClass("primary", "md")}>
                  <ArrowDown className="h-4 w-4" strokeWidth={2} aria-hidden />
                  احسمه هنا
                </a>
                {outward && (
                  <LinkButton href={item.href} variant="quiet" size="md">
                    افتح سجلّاته كاملة
                  </LinkButton>
                )}
              </>
            ) : (
              <>
                <LinkButton href={item.href} variant="primary" size="md" icon={ArrowLeft}>
                  {item.actionLabel ?? "افتح السجلّات"}
                </LinkButton>
                <span className="text-[11px] text-muted">يُفتح موضعُ إصلاحه — ويخرج من هنا حين يُصلَح.</span>
              </>
            )}
          </div>
        </div>
      </header>

      {/*
        الدليلُ يُعرَض حين لا لوحَ فعلٍ تحته — فاللوحُ يعرض الشيءَ نفسه ومعه
        زرُّه، ومن يقرأ قائمتين متشابهتين يحسبهما شيئين.
      */}
      {!workspace && item.evidence.length > 0 && <EvidenceList evidence={item.evidence} />}

      {workspace && (
        <section id="resolve" aria-labelledby="resolve-title" className="scroll-mt-24">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 id="resolve-title" className="flex items-center gap-2 text-[15px] font-bold">
              <Zap className="h-[18px] w-[18px] text-accent" strokeWidth={2} aria-hidden />
              احسمه هنا
            </h3>
            <p className="text-[11px] text-muted">ما تفعله يُحفَظ فوراً، ويخرج البندُ من الطابور حين يُحسَم كلُّه.</p>
          </div>
          {workspace}
        </section>
      )}
    </article>
  );
}

function Pager({
  nav,
  total,
  lens,
}: {
  nav: ReturnType<typeof neighbours>;
  total: number;
  lens: Lens;
}) {
  if (nav.index === -1 || total < 2) return null;
  const cell = "grid h-11 w-11 place-items-center rounded-lg border border-line bg-raised text-ink-soft sm:h-8 sm:w-8";
  return (
    <nav aria-label="التنقّل بين البنود" className="flex items-center gap-1.5">
      {nav.prev ? (
        <Link href={itemHref(nav.prev.id, lens)} aria-label={`البند السابق: ${nav.prev.title}`} className={`${cell} hover:bg-hover hover:text-ink`}>
          <ChevronRight className="h-4 w-4" strokeWidth={2} aria-hidden />
        </Link>
      ) : (
        <span aria-hidden className={`${cell} opacity-40`}><ChevronRight className="h-4 w-4" strokeWidth={2} /></span>
      )}
      <span className="min-w-12 text-center text-[11px] font-medium text-muted">
        <span className="nums font-bold text-ink">{nav.index + 1}</span> من <span className="nums">{total}</span>
      </span>
      {nav.next ? (
        <Link href={itemHref(nav.next.id, lens)} aria-label={`البند التالي: ${nav.next.title}`} className={`${cell} hover:bg-hover hover:text-ink`}>
          <ChevronLeft className="h-4 w-4" strokeWidth={2} aria-hidden />
        </Link>
      ) : (
        <span aria-hidden className={`${cell} opacity-40`}><ChevronLeft className="h-4 w-4" strokeWidth={2} /></span>
      )}
    </nav>
  );
}

/** الدليلُ: خمسةٌ ظاهرة، والباقي خلف «اعرض الباقي» — والطويلُ لا يدفع الفعلَ بعيداً. */
function EvidenceList({ evidence }: { evidence: readonly AttentionEvidence[] }) {
  const shown = evidence.slice(0, EVIDENCE_SHOWN);
  const rest = evidence.slice(EVIDENCE_SHOWN);
  return (
    <section aria-labelledby="evidence-title" className="overflow-hidden rounded-2xl border border-line bg-raised shadow-raised">
      <h3 id="evidence-title" className="flex items-center gap-2 border-b border-line-soft px-5 py-3.5 text-sm font-bold">
        <ScanSearch className="h-4 w-4 text-muted" strokeWidth={2} aria-hidden />
        ما بُني عليه هذا البند
        <span className="nums rounded-full bg-sunken px-2 py-0.5 text-[11px] text-ink-soft">{evidence.length}</span>
      </h3>
      <ul className="divide-y divide-line-soft">
        {shown.map((e, i) => <EvidenceRow key={i} e={e} />)}
      </ul>
      {rest.length > 0 && (
        <details className="group border-t border-line-soft">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-center gap-1.5 text-xs font-bold text-accent hover:bg-hover [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">اعرض الباقي <span className="nums">({rest.length})</span></span>
            <span className="hidden group-open:inline">أخفِ الباقي</span>
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" strokeWidth={2} aria-hidden />
          </summary>
          <ul className="divide-y divide-line-soft border-t border-line-soft">
            {rest.map((e, i) => <EvidenceRow key={i} e={e} />)}
          </ul>
        </details>
      )}
    </section>
  );
}

function EvidenceRow({ e }: { e: AttentionEvidence }) {
  return (
    <li className="flex items-start justify-between gap-4 px-5 py-2.5">
      <div className="min-w-0">
        {e.href ? (
          <Link href={e.href} className="inline-flex flex-wrap items-baseline gap-x-2 text-[13px] font-medium hover:text-accent">
            <span dir="auto">{e.label}</span>
            <span className="text-[11px] font-bold text-accent">صحّحها ←</span>
          </Link>
        ) : (
          <p className="text-[13px] font-medium" dir="auto">{e.label}</p>
        )}
        {e.sub && <p className="mt-0.5 text-[11px] leading-relaxed text-muted"><Prose text={e.sub} /></p>}
      </div>
      {e.amountMinor !== undefined && (
        <span className="nums-col shrink-0 pt-px text-[13px] font-bold">
          <Money minor={e.amountMinor} />
        </span>
      )}
    </li>
  );
}

/** ريثما يُقرأ لوحُ الفعل — القائمةُ والتفصيلُ لا ينتظرانه. */
export function WorkspaceSkeleton() {
  return (
    <div aria-busy="true" className="overflow-hidden rounded-xl border border-line bg-raised">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-t border-line-soft px-4 py-4 first:border-t-0">
          <div className="skeleton h-8 w-8 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-3.5 w-2/5" />
            <div className="skeleton h-3 w-1/4" />
          </div>
          <div className="skeleton h-8 w-28 rounded-lg" />
        </div>
      ))}
      <span className="sr-only">يُحمّل لوحُ الفعل…</span>
    </div>
  );
}

/* ─────────────────────────── الفراغ ─────────────────────────── */

/**
 * لا شيء ينتظر — طمأنينةٌ بسندها: ما فُحص فخلا. وإن بقي أساسٌ لم يُستورَد
 * قيل إنّ الفراغ على ما قُرئ وحده، ودُلّ على ما يكمله.
 */
export function AllClear({ start, canPay = false }: { start: StartState; canPay?: boolean }) {
  const next = start.steps.find((s) => !s.done);
  return (
    <div className="space-y-5">
      <section className="animate-rise rounded-2xl border border-ok/25 bg-ok-bg px-6 py-10 text-center sm:py-14">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-raised text-ok shadow-raised">
          <CircleCheck className="h-7 w-7" strokeWidth={1.9} aria-hidden />
        </span>
        <h2 className="mt-4 text-lg font-bold">لا شيء ينتظر قرارك.</h2>
        <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-ink-soft">
          كلُّ ما يعرفه النظام سليم. وحين يصل مستندٌ أو كشفٌ يحتاج قراراً يظهر هنا بسببه وفعله.
        </p>
        <ul className="mx-auto mt-5 flex max-w-lg flex-wrap justify-center gap-x-5 gap-y-2 text-xs font-medium text-ink-soft">
          {["لا مالٌ خرج مرّتين", "لا دفعةٌ بلا مستند", "لا مستندٌ ينتظر"].map((t) => (
            <li key={t} className="inline-flex items-center gap-1.5">
              <CircleCheck className="h-3.5 w-3.5 text-ok" strokeWidth={2.25} aria-hidden />
              {t}
            </li>
          ))}
        </ul>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <LinkButton href="/suppliers" variant="secondary">افتح حسابات المورّدين</LinkButton>
          {canPay && <LinkButton href="/payments" variant="quiet">دفعة الشهر</LinkButton>}
        </div>
      </section>
      {start.incomplete && next && (
        <section className="rounded-2xl border border-accent-line bg-accent-soft/60 p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Sparkles className="h-4 w-4 text-accent" strokeWidth={2} aria-hidden />
            الفراغُ على ما قُرئ وحده
          </h2>
          <p className="mb-4 mt-1 text-xs leading-relaxed text-ink-soft">ما لم يُستورَد مجهولٌ لا سليم — أكمِله ليُفحَص.</p>
          <StartSteps start={start} />
        </section>
      )}
    </div>
  );
}

/** قاعدةٌ لا تعرف شيئاً — لا يُقال «سليم»، بل يُدَلّ على البداية. */
export function KnowsNothing({ start }: { start: StartState }) {
  return (
    <section className="animate-rise rounded-2xl border border-accent-line bg-accent-soft/60 p-5 sm:p-6">
      <h2 className="flex items-center gap-2 text-base font-bold">
        <Sparkles className="h-[18px] w-[18px] text-accent" strokeWidth={2} aria-hidden />
        لا يعرف النظامُ شيئاً بعد
      </h2>
      <p className="mb-4 mt-1 max-w-2xl text-xs leading-relaxed text-ink-soft">
        يظهر هنا ما يحتاج قرارك حين يقرأ مستنداتِك وكشفَ بنكك — والفراغُ الآن لا يعني أنّ كلَّ شيءٍ سليم.
      </p>
      <StartSteps start={start} />
    </section>
  );
}

function StartSteps({ start }: { start: StartState }) {
  const current = start.steps.find((x) => !x.done);
  return (
    <Stepper
      steps={start.steps.map((s) => ({
        id: s.id,
        title: s.title,
        detail: s.done ? undefined : s.detail,
        state: s.done ? "done" : s === current ? "current" : "todo",
        action: s.done ? undefined : (
          <Link href={s.href} className={buttonClass(s === current ? "primary" : "secondary", "sm")}>
            {s.action}
          </Link>
        ),
      }))}
    />
  );
}

/** عدسةٌ فرغت (حُسم آخرُ ما فيها) والطابورُ غيرُ فارغ. */
export function LensEmpty({ lens }: { lens: Lens }) {
  const label = lens === "signals" ? "الإشارات" : lens === "all" ? "الطابور" : AREA_LABEL[lens];
  return (
    <div className="rounded-2xl border border-dashed border-line bg-raised/60 px-6 py-12 text-center">
      <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-ok-bg text-ok">
        <CircleCheck className="h-5 w-5" strokeWidth={1.9} aria-hidden />
      </span>
      <p className="mt-3 text-sm font-bold">لا شيء في «{label}» الآن.</p>
      <p className="mx-auto mt-1 max-w-sm text-xs text-muted">حُسم ما كان فيه — وبقي غيرُه في الطابور.</p>
      <div className="mt-5">
        <LinkButton href="/attention" variant="primary" icon={ArrowLeft}>اعرض كلَّ البنود</LinkButton>
      </div>
    </div>
  );
}
