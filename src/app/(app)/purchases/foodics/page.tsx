import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleCheck, FileQuestion, FileX2, Link2, PackageSearch, Scale, Undo2, X } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { FoodicsStatusBar } from "@/components/foodics-status";
import { FoodicsSupplierLink } from "@/components/foodics-supplier-link";
import { SignalControls } from "@/components/signal-controls";
import { Badge, Callout, DataTable, EmptyState, KeyFigure, LinkButton, NoAccess, Section } from "@/components/ui";
import { INVOICE, countNoun } from "@/lib/arabic";
import { formatDay } from "@/lib/riyadh-time";
import { invoiceHref } from "@/lib/invoice-profile";
import { milliToDecimal } from "@/lib/inventory/units";
import type { InvoiceSide, MatchBasis, MatchedPair, PurchaseSide } from "@/lib/foodics/purchase-compare";
import { loadPairLines, loadPurchaseWitness, type FoodicsSupplierRow } from "@/services/foodics-compare.service";
import { loadFoodicsStatus } from "@/services/foodics-sync.service";
import { loadFoodicsSilenced } from "@/services/foodics-takings.service";
import { invoiceSignalKey as invoiceKey, purchaseSignalKey as purchaseKey } from "@/services/foodics-attention.service";

export const dynamic = "force-dynamic";

const BASIS: Record<MatchBasis, string> = {
  SUPPLIER_DAY_AMOUNT: "بالمورّد واليوم والمبلغ",
  SUPPLIER_DATE_AMOUNT: "بالمورّد والمبلغ، بتاريخٍ قريب",
  NUMBER: "برقم الفاتورة",
  NUMBER_TAIL: "بآخر أرقامها",
};


/**
 * فودكس والفواتير — مشترياتُ فودكس أمام فواتير الدرايف.
 *
 * شاهدان على واقعةٍ واحدة (`lib/foodics/purchase-compare.ts`): ما اتّفقا عليه
 * مؤكَّدٌ من جهتين، وما اختلفا فيه يُعرَض بطرفيه. ولا تُنشأ فاتورةٌ من هنا ولا
 * يُصحَّح مبلغ — الحكمُ لصاحب المقهى أمام المستند.
 */
export default async function FoodicsPurchasesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await currentUser();
  if (!user) redirect("/login?from=/purchases/foodics");
  if (!can(user.role, "amounts:view")) {
    return (
      <PageShell user={user} width="wide" title="فودكس والفواتير">
        <NoAccess what="مقارنة مشتريات فودكس بالفواتير" />
      </PageShell>
    );
  }

  const params = await searchParams;
  const [status, w, silenced] = await Promise.all([loadFoodicsStatus(), loadPurchaseWitness(), loadFoodicsSilenced("foodics-purchase")]);
  const canLink = can(user.role, "supplier:edit");
  const canSilence = can(user.role, "bank:edit");
  const canSync = can(user.role, "inventory:count");
  const c = w.comparison;

  if (c.foodicsSince === null) {
    return (
      <PageShell user={user} width="wide" title="فودكس والفواتير" intro="ما أُدخل في فودكس شراءً، أمام ما في الدرايف من فواتير.">
        <FoodicsStatusBar status={status} canSync={canSync} />
        <div className="mt-6">
          <EmptyState icon={PackageSearch} title="لا حركاتِ شراءٍ من فودكس بعد." hint="تُقرأ حركاتُ الشراء ومورّدوها من واجهة فودكس، ثمّ تُقابَل بفواتيرك. اضغط «زامن الآن» أعلاه." />
        </div>
      </PageShell>
    );
  }

  const differs = c.matched.filter((m) => !m.agrees && !silenced.has(purchaseKey(m.purchase.id)));
  const onlyFoodics = c.onlyFoodics.filter((p) => !silenced.has(purchaseKey(p.id)));
  const onlyOurs = c.onlyOurs.filter((i) => !silenced.has(invoiceKey(i.id)));
  const agreed = c.matched.filter((m) => m.agrees);
  const silencedCount = c.matched.filter((m) => !m.agrees).length - differs.length + (c.onlyFoodics.length - onlyFoodics.length) + (c.onlyOurs.length - onlyOurs.length);

  const suggestion = new Map(w.suggestions.map((s) => [s.foodicsSupplierId, s]));
  const active = w.foodicsSuppliers.filter((s) => s.purchases > 0);
  /* ما له دليلٌ أوّلاً — هو ما يُحسَم بضغطة */
  const unlinked = active.filter((s) => s.linkedSupplierId === null)
    .sort((a, b) => Number(suggestion.has(b.id)) - Number(suggestion.has(a.id)) || b.purchases - a.purchases);
  const linked = active.filter((s) => s.linkedSupplierId !== null);

  /* لوحُ البنود: حركةٌ بعينها وما قابلها — يُفتح برابطٍ ويُغلق برابط */
  const openId = params.p ?? null;
  const openPair = openId ? c.matched.find((m) => m.purchase.id === openId) ?? null : null;
  const openPurchase = openPair?.purchase ?? (openId ? c.onlyFoodics.find((p) => p.id === openId) ?? null : null);
  const lines = openPurchase ? await loadPairLines(openPurchase.id, openPair?.invoice.id ?? null) : null;

  const sum = (rows: readonly { totalMinor: number }[]) => rows.reduce((s, r) => s + r.totalMinor, 0);

  return (
    <PageShell
      user={user}
      width="wide"
      title="فودكس والفواتير"
      eyebrow={<>حركاتُ الشراء في فودكس منذ <bdi>{formatDay(c.foodicsSince)}</bdi></>}
      intro="ما أُدخل في فودكس شراءً أمام ما في الدرايف من فواتير: ما اتّفقا عليه، وما في أحدهما وليس في الآخر، وما اختلف مبلغُه."
    >
      <FoodicsStatusBar status={status} canSync={canSync} />

      <div className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
        <KeyFigure
          icon={FileQuestion}
          label="في فودكس ولا فاتورةَ عندنا"
          tone={onlyFoodics.length > 0 ? "warn" : "ok"}
          value={<span className="nums">{onlyFoodics.length}</span>}
          sub={onlyFoodics.length > 0 ? <>بمجموع <Money minor={sum(onlyFoodics)} /> — مستندٌ لم يصل الدرايف، أو مورّدٌ لم يُربَط بعد.</> : "كلُّ حركةِ شراءٍ لها فاتورةٌ عندنا."}
          href="#only-foodics"
        />
        <KeyFigure
          icon={FileX2}
          label="عندنا وليست في فودكس"
          tone={onlyOurs.length > 0 ? "warn" : "ok"}
          value={<span className="nums">{onlyOurs.length}</span>}
          sub={onlyOurs.length > 0 ? <>بمجموع <Money minor={sum(onlyOurs)} /> — بضاعةٌ لم تدخل مخزونَ فودكس.</> : "لا فاتورةَ لمورّدٍ يتابعه فودكس غائبةٌ عنه."}
          href="#only-ours"
        />
        <KeyFigure
          icon={Scale}
          label="اتّفقا: المورّدُ واليومُ والمبلغ"
          tone={differs.length > 0 ? "warn" : "ok"}
          value={<span className="nums">{agreed.length}</span>}
          sub={differs.length > 0 ? <>و{countNoun(differs.length, INVOICE)} اختلف مبلغُها بين الطرفين.</> : "ولا فاتورةَ اختلف مبلغُها."}
          href={differs.length > 0 ? "#differs" : "#agreed"}
        />
      </div>

      {/* ── لوحُ البنود ── */}
      {openPurchase && lines && (
        <section aria-label="بنودُ الحركة" className="mt-6 rounded-2xl border border-line bg-raised p-4 shadow-raised sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-muted">حركةُ شراءٍ في فودكس</p>
              <h2 className="mt-0.5 text-base font-bold">
                <bdi dir="ltr">{openPurchase.reference}</bdi> · {openPurchase.foodicsSupplierName ?? "بلا مورّد"} · فاتورة <bdi dir="ltr">{openPurchase.invoiceNumber ?? "—"}</bdi>
              </h2>
              <p className="mt-1 text-xs text-ink-soft">
                في فودكس <Money minor={openPurchase.totalMinor} />
                {openPair ? <> · عندنا <Money minor={openPair.invoice.totalMinor} /> ({openPair.invoice.supplierName} · <bdi dir="ltr">{openPair.invoice.invoiceNumber}</bdi>)</> : " · لا فاتورةَ تقابلها عندنا"}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {openPair && <LinkButton href={invoiceHref(openPair.invoice.id)} variant="secondary" size="sm">افتح فاتورتَنا</LinkButton>}
              <LinkButton href="/purchases/foodics" variant="quiet" size="sm" icon={X}>أغلِق</LinkButton>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
            <div className="min-w-0">
              <p className="mb-2 text-xs font-bold text-ink-soft">كما أُدخلت في فودكس (قبل الضريبة)</p>
              <DataTable
                rows={lines.foodics.map((l, i) => ({ ...l, i }))}
                keyOf={(l) => String(l.i)}
                columns={[
                  { key: "name", header: "الصنف", primary: true, cell: (l) => <span>{l.name}</span> },
                  { key: "qty", header: "الكمّيّة", numeric: true, cell: (l) => <span className="nums">{milliToDecimal(l.quantityMilli)}{l.unit ? ` ${l.unit}` : ""}</span> },
                  { key: "cost", header: "كلفةُ السطر", numeric: true, cell: (l) => <Money minor={l.costMinor} /> },
                ]}
              />
            </div>
            <div className="min-w-0">
              <p className="mb-2 text-xs font-bold text-ink-soft">كما قُرئت من فاتورتنا</p>
              {lines.ours.length === 0 ? (
                <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-xs text-muted">
                  {openPair ? "فاتورتُنا بلا بنودٍ مقروءة." : "لا فاتورةَ تقابل هذه الحركة."}
                </p>
              ) : (
                <DataTable
                  rows={lines.ours.map((l, i) => ({ ...l, i }))}
                  keyOf={(l) => String(l.i)}
                  columns={[
                    { key: "name", header: "البند", primary: true, cell: (l) => <span>{l.description}</span> },
                    { key: "qty", header: "الكمّيّة", numeric: true, cell: (l) => <span className="nums">{l.qty ?? "—"}</span> },
                    { key: "total", header: "إجماليُّ السطر", numeric: true, cell: (l) => (l.lineTotalMinor === null ? <span className="text-muted">غير معروف</span> : <Money minor={l.lineTotalMinor} />) },
                  ]}
                />
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── ربطُ المورّدين ── */}
      {(unlinked.length > 0 || linked.length > 0) && (
        <Section
          id="suppliers"
          title="مورّدو فودكس ومن يقابلهم عندنا"
          icon={Link2}
          count={unlinked.length}
          hint="الاسمُ ليس هويّة: «Lanius» في فودكس «سرد كو» عندنا. فالاقتراحُ من الفواتير التي طابقت رقماً ومبلغاً لا من الاسم، والربطُ بضغطتك. والمقابلةُ بالمورّد واليوم والمبلغ تحتاج الربط — بدونه لا يبقى إلّا رقمُ الفاتورة."
        >
          {unlinked.length === 0 ? (
            <p className="rounded-xl border border-line bg-raised px-4 py-3 text-xs text-muted shadow-raised">كلُّ مورّدٍ له حركاتُ شراءٍ مربوط.</p>
          ) : (
            <ul className="space-y-2">
              {unlinked.map((s) => {
                const hint = suggestion.get(s.id);
                const byName = hint ? null : w.nameHints[s.id] ?? null;
                return (
                  <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-raised px-4 py-3 shadow-raised">
                    <div className="min-w-0 flex-1 basis-56">
                      <p className="text-sm font-bold">{s.name}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">
                        <span className="nums">{s.purchases}</span> حركة بمجموع <Money minor={s.totalMinor} />.{" "}
                        {hint
                          ? <>المقترَح «{hint.supplierName}»: <span className="nums">{hint.evidence}</span> من حركاته طابقت فواتيرَه رقماً ومبلغاً.</>
                          : byName
                            ? <>لم تطابق حركاتُه فاتورةً برقمها بعد. الاسمُ يشبه «{byName.supplierName}» — <strong>شبهُ اسمٍ لا دليل</strong>، فتحقّق قبل أن تربط.</>
                            : "لا اقتراح: لم تطابق حركاتُه فواتيرَ مورّدٍ واحد. إن كان اسماً جامعاً لعدّة مورّدين («مورد حبوب قهوة») فاتركه بلا ربط."}
                      </p>
                    </div>
                    {canLink && (
                      <div className="min-w-0 flex-1 basis-72">
                        <FoodicsSupplierLink foodicsSupplierId={s.id} linkedSupplierId={null} suggestedSupplierId={hint?.supplierId ?? byName?.supplierId ?? null} suppliers={w.ourSuppliers} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {linked.length > 0 && (
            <details className="mt-3 rounded-xl border border-line bg-raised px-4 py-3 text-xs shadow-raised">
              <summary className="cursor-pointer font-bold text-ink-soft">المربوطون ({linked.length})</summary>
              <ul className="mt-3 space-y-3">
                {linked.map((s) => <LinkedRow key={s.id} s={s} canLink={canLink} suppliers={w.ourSuppliers} />)}
              </ul>
            </details>
          )}
        </Section>
      )}

      {/* ── المبلغُ مختلف ── */}
      {differs.length > 0 && (
        <Section
          id="differs"
          title="الرقمُ نفسُه والمبلغُ مختلف"
          icon={Scale}
          count={differs.length}
          hint="لم تُوجد للحركة فاتورةٌ بمبلغها، ووُجدت فاتورةٌ برقمها بمبلغٍ آخر. أحدُ الطرفين قُرئ أو أُدخل خطأً — افتح المستندَ واحكم."
        >
          <ul className="space-y-2">
            {differs.map((m) => <DiffersRow key={m.purchase.id} m={m} canSilence={canSilence} />)}
          </ul>
        </Section>
      )}

      {/* ── في فودكس ولا فاتورة ── */}
      <Section
        id="only-foodics"
        title="في فودكس ولا فاتورةَ عندنا"
        icon={FileQuestion}
        count={onlyFoodics.length}
        hint="حركةُ شراءٍ مُرحَّلةٌ في فودكس لا فاتورةَ عندنا لمورّدها بمبلغها في يومها ولا قريباً منه. لمورّدٍ مربوط: المستندُ لم يصل الدرايف، أو مبلغُه في فودكس غيرُ ما في الفاتورة. ولغير المربوط: اربطه أعلاه أوّلاً."
      >
        <DataTable<PurchaseSide>
          rows={onlyFoodics}
          keyOf={(p) => p.id}
          hrefOf={(p) => `/purchases/foodics?p=${encodeURIComponent(p.id)}`}
          empty={<span>كلُّ حركةِ شراءٍ في فودكس لها فاتورةٌ عندنا.</span>}
          columns={[
            { key: "date", header: "تاريخُها", primary: true, cell: (p) => <span><bdi className="font-bold">{formatDay(p.invoiceDate ?? p.businessDate)}</bdi><span className="ms-2 text-xs text-muted">{p.foodicsSupplierName ?? "بلا مورّد"}</span></span> },
            { key: "number", header: "رقمُ الفاتورة في فودكس", cell: (p) => <bdi dir="ltr" className="font-mono text-xs">{p.invoiceNumber ?? "—"}</bdi> },
            { key: "ref", header: "مرجعُ فودكس", secondary: true, cell: (p) => <bdi dir="ltr" className="font-mono text-xs text-muted">{p.reference}</bdi> },
            { key: "linked", header: "المورّد", secondary: true, cell: (p) => (p.linkedSupplierId ? <Badge tone="ok">مربوط</Badge> : <Badge>لم يُربَط</Badge>) },
            { key: "total", header: "الإجمالي", numeric: true, cell: (p) => <Money minor={p.totalMinor} /> },
            ...(canSilence ? [{ key: "act", header: "", wrap: true, cell: (p: PurchaseSide) => <span className="flex flex-wrap gap-1"><SignalControls signalKey={purchaseKey(p.id)} dismissLabel="ليست فاتورةً تُنتظَر" snoozeDays={30} /></span> }] : []),
          ]}
        />
      </Section>

      {/* ── عندنا وليست في فودكس ── */}
      <Section
        id="only-ours"
        title="عندنا وليست في فودكس"
        icon={FileX2}
        count={onlyOurs.length}
        hint="فاتورةٌ لمورّدٍ يتابعه فودكس، بعد أوّل حركةٍ فيه، ولا حركةَ شراءٍ تقابلها. بضاعتُها لم تدخل مخزونَ فودكس — فحسابُه للمخزون ناقصٌ بقدرها. (جردُنا لا يتأثّر: يُحسَب من فواتيرنا.)"
      >
        <DataTable<InvoiceSide>
          rows={onlyOurs}
          keyOf={(i) => i.id}
          hrefOf={(i) => invoiceHref(i.id)}
          empty={<span>لا فاتورةَ لمورّدٍ يتابعه فودكس غائبةٌ عنه.</span>}
          columns={[
            { key: "date", header: "تاريخُها", primary: true, cell: (i) => <span><bdi className="font-bold">{formatDay(i.day)}</bdi><span className="ms-2 text-xs text-muted">{i.supplierName}</span></span> },
            { key: "number", header: "رقمُ الفاتورة", cell: (i) => <bdi dir="ltr" className="font-mono text-xs">{i.invoiceNumber}</bdi> },
            { key: "total", header: "الإجمالي", numeric: true, cell: (i) => <Money minor={i.totalMinor} /> },
            ...(canSilence ? [{ key: "act", header: "", wrap: true, cell: (i: InvoiceSide) => <span className="flex flex-wrap gap-1"><SignalControls signalKey={invoiceKey(i.id)} dismissLabel="لا تدخل مخزونَ فودكس" snoozeDays={30} /></span> }] : []),
          ]}
        />
        {c.outOfScope > 0 && (
          <p className="mt-3 text-xs leading-relaxed text-muted">
            و{countNoun(c.outOfScope, INVOICE)} أخرى خارج المقارنة: لمورّدٍ لا يتابعه فودكس (معدّات، خدمات، اشتراكات) أو قبل <bdi>{formatDay(c.foodicsSince)}</bdi>.
            ربطُ مورّدٍ أعلاه يُدخل فواتيرَه في المقارنة.
          </p>
        )}
      </Section>

      {/* ── المتّفقة ── */}
      <Section id="agreed" title="اتّفقا" icon={CircleCheck} count={agreed.length} hint="فاتورةٌ مؤكَّدةٌ من جهتين: للمورّد نفسِه في اليوم نفسِه بالمبلغ نفسِه. رقمُ الفاتورة لا يُشترَط — يُكتب في فودكس بيدٍ — وإن طابق فتأكيدٌ زائد.">
        <details className="rounded-xl border border-line bg-raised px-4 py-3 text-xs shadow-raised">
          <summary className="cursor-pointer font-bold text-ink-soft">اعرض {countNoun(agreed.length, INVOICE)}</summary>
          <div className="mt-3">
            <DataTable<MatchedPair>
              rows={agreed}
              keyOf={(m) => m.purchase.id}
              hrefOf={(m) => `/purchases/foodics?p=${encodeURIComponent(m.purchase.id)}`}
              columns={[
                { key: "date", header: "التاريخ", primary: true, cell: (m) => <span><bdi className="font-bold">{formatDay(m.invoice.day)}</bdi><span className="ms-2 text-xs text-muted">{m.invoice.supplierName}</span></span> },
                { key: "number", header: "رقمُ الفاتورة", cell: (m) => <bdi dir="ltr" className="font-mono text-xs">{m.invoice.invoiceNumber}</bdi> },
                { key: "basis", header: "طُوبقت", secondary: true, cell: (m) => <span className="text-muted">{BASIS[m.basis]}{m.numberConfirms && m.basis !== "NUMBER" && <span className="ms-2"><Badge tone="ok">والرقمُ يؤكّده</Badge></span>}</span> },
                { key: "total", header: "الإجمالي", numeric: true, cell: (m) => <Money minor={m.invoice.totalMinor} /> },
              ]}
            />
          </div>
        </details>
      </Section>

      {(w.returns.length > 0 || silencedCount > 0) && (
        <Callout tone="info" icon={Undo2} className="mt-8">
          {w.returns.length > 0 && (
            <>
              <strong className="text-ink">مرتجَعٌ إلى المورّد في فودكس:</strong>{" "}
              {w.returns.map((r, i) => (
                <span key={r.reference}>{i > 0 && " · "}<bdi dir="ltr">{r.reference}</bdi> ({r.supplierName ?? "بلا مورّد"} · <bdi>{formatDay(r.businessDate)}</bdi> · <Money minor={r.totalMinor} />)</span>
              ))}
              . تأكّد أنّ له إشعاراً دائناً عندنا — لا يُطابَق هنا بفاتورة.{" "}
            </>
          )}
          {silencedCount > 0 && <>وأسكتَّ {silencedCount} من بنود هذه الصفحة — تجدها في <Link href="/settings/choices" className="font-bold underline underline-offset-4">ما قرّرتَه</Link>.</>}
        </Callout>
      )}
    </PageShell>
  );
}

function LinkedRow({ s, canLink, suppliers }: { s: FoodicsSupplierRow; canLink: boolean; suppliers: readonly { id: string; name: string }[] }) {
  return (
    <li className="flex flex-wrap items-center gap-3">
      <p className="min-w-0 flex-1 basis-56">
        <span className="font-bold text-ink">{s.name}</span> ← {s.linkedSupplierName}
        <span className="ms-2 text-muted"><span className="nums">{s.purchases}</span> حركة</span>
      </p>
      {canLink && (
        <div className="min-w-0 flex-1 basis-72">
          <FoodicsSupplierLink foodicsSupplierId={s.id} linkedSupplierId={s.linkedSupplierId} suggestedSupplierId={null} suppliers={suppliers} />
        </div>
      )}
    </li>
  );
}

function DiffersRow({ m, canSilence }: { m: MatchedPair; canSilence: boolean }) {
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl border border-warn/30 bg-warn-bg px-4 py-3">
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-sm font-bold">
          {m.invoice.supplierName} · فاتورة <bdi dir="ltr">{m.invoice.invoiceNumber}</bdi> · <bdi>{formatDay(m.invoice.day)}</bdi>
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">
          في فودكس <Money minor={m.purchase.totalMinor} /> وعندنا <Money minor={m.invoice.totalMinor} /> — الفرق <Money minor={m.gapMinor} signed />.
          {m.supplierConflict && " ومورّدُ فودكس مربوطٌ بغير مورّد هذه الفاتورة — راجِع الربط."}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        <LinkButton href={`/purchases/foodics?p=${encodeURIComponent(m.purchase.id)}`} variant="secondary" size="sm">قارِن البنود</LinkButton>
        <LinkButton href={invoiceHref(m.invoice.id)} variant="secondary" size="sm">افتح الفاتورة</LinkButton>
        {canSilence && <SignalControls signalKey={purchaseKey(m.purchase.id)} dismissLabel="عرفتُ سببَه" snoozeDays={30} />}
      </div>
    </li>
  );
}
