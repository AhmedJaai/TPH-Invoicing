import { redirect } from "next/navigation";
import { BookOpen, FileText, Inbox } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { PostAction } from "@/components/post-action";
import { BoardEditor, BoardRow, DecideButtons } from "@/components/payroll/team-admin";
import { Badge, EmptyState, NoAccess, Section } from "@/components/ui";
import { addDays, currentMonthRiyadh, formatDay, formatMonth } from "@/lib/riyadh-time";
import { formatQuantity } from "@/lib/team-units";
import { WASTE_REASON_LABEL } from "@/lib/inventory/waste-board";
import { TEAM_APP_NAME } from "@/lib/team-app";
import { publishedSlipMonths } from "@/services/payroll.service";
import { BOARD_KINDS, BOARD_LABEL, decidedRequests, loadBoard, pendingRequests, type RequestView } from "@/services/team-board.service";
import type { TeamBoardKind } from "@/db/schema";

export const dynamic = "force-dynamic";

const KIND = { BOARD_EDIT: "اقتراح تعديل", LEAVE: "إجازة", SWAP: "تبديل", WASTE: "تالف أو ضائع" } as const;
const APPROVE = { BOARD_EDIT: "اعتمد التعديل", LEAVE: "اعتمد الإجازة", SWAP: "اعتمد التبديل", WASTE: "سجّله في الهدر" } as const;

/**
 * «TPH Team» عند صاحب المقهى: طلباتُ الموظّفين تنتظر قرارَه، والمرجعُ الذي يقرؤونه، ونشرُ قسائمهم.
 */
export default async function TeamAdminPage() {
  const user = await currentUser();
  if (!user) redirect("/login?from=/payroll/team");
  if (!can(user.role, "payroll:view")) return <PageShell user={user} title="المرجع والطلبات"><NoAccess what="الموظفين" /></PageShell>;
  const canEdit = can(user.role, "payroll:edit");
  const month = currentMonthRiyadh();
  const lastMonth = addDays(`${month}-01`, -1).slice(0, 7);
  const [pending, decided, board, published] = await Promise.all([pendingRequests(), decidedRequests(), loadBoard(), publishedSlipMonths()]);

  return (
    <PageShell user={user} title="المرجع والطلبات" intro={`ما يقرؤه الفريق في ${TEAM_APP_NAME} (الوصفات والطحنات والنظافة والبن والإعلانات)، وما يطلبونه منك: إجازة، تبديل، تالف، أو تعديل على المرجع. لا يُنفَّذ طلبٌ قبل أن تعتمده.`}>
      <Section id="requests" title="طلبات تنتظرك" icon={Inbox} count={pending.length}>
        {pending.length === 0 ? <EmptyState compact icon={Inbox} title="لا طلبات تنتظر." /> : (
          <ul className="space-y-3">{pending.map((r) => <RequestCard key={r.id} r={r} canEdit={canEdit} />)}</ul>
        )}
      </Section>

      <Section id="slips" title="قسيمة الراتب في تطبيقهم" icon={FileText} hint="لا يرى الموظف قسيمته إلا بعد أن تنشرها، ويرى آخر شهر نشرته.">
        <ul className="divide-y divide-line rounded-xl border border-line bg-raised shadow-raised">
          {[month, lastMonth].map((m) => (
            <li key={m} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-0 flex-1 font-bold">{formatMonth(m)}</span>
              {published.includes(m) ? <Badge tone="ok">منشورة</Badge> : <Badge tone="muted">غير منشورة</Badge>}
              {canEdit && <PostAction url="/api/payroll/team" body={{ action: "publish", month: m, published: !published.includes(m) }} variant="quiet" done="حُفظ">{published.includes(m) ? "أخفها" : "انشرها"}</PostAction>}
            </li>
          ))}
        </ul>
      </Section>

      {BOARD_KINDS.map((kind: TeamBoardKind) => {
        const items = board.filter((b) => b.kind === kind);
        return (
          <Section key={kind} id={`board-${kind}`} title={kind === "ANNOUNCEMENT" ? "إعلانات (تظهر أول ما يفتح التطبيق)" : BOARD_LABEL[kind]} icon={BookOpen} count={items.length}>
            {items.length > 0 && (
              <ul className="mb-3 divide-y divide-line rounded-xl border border-line bg-raised shadow-raised">
                {items.map((i) => canEdit ? <BoardRow key={i.id} kind={kind} item={i} /> : <li key={i.id} className="px-4 py-3 text-sm font-bold">{i.title}</li>)}
              </ul>
            )}
            {canEdit && (
              <details className="rounded-xl border border-line bg-raised" open={items.length === 0 && kind !== "ANNOUNCEMENT"}>
                <summary className="cursor-pointer px-4 py-3 text-sm font-bold">أضف {BOARD_LABEL[kind]}</summary>
                <div className="border-t border-line p-4"><BoardEditor kind={kind} /></div>
              </details>
            )}
          </Section>
        );
      })}

      {decided.length > 0 && (
        <Section title="ما قرّرته" icon={Inbox} count={decided.length}>
          <ul className="divide-y divide-line rounded-xl border border-line bg-raised shadow-raised">
            {decided.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1">{KIND[r.kind]} · {r.employeeName} · {summary(r)}</span>
                {r.status === "APPROVED" ? <Badge tone="ok">اعتُمد</Badge> : <Badge tone="muted">رُفض</Badge>}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </PageShell>
  );
}

function summary(r: RequestView): string {
  if (r.kind === "LEAVE") return r.toDay && r.toDay !== r.fromDay ? `${formatDay(r.fromDay!)} إلى ${formatDay(r.toDay)}` : formatDay(r.fromDay!);
  if (r.kind === "SWAP") return `راحة ${r.employeeName} ${formatDay(r.fromDay!)} براحة ${r.withEmployeeName ?? "زميل"} ${r.toDay ? formatDay(r.toDay) : ""}`;
  if (r.kind === "WASTE") return `${r.productName ?? "صنف"} ${r.quantityMilli !== null && r.unit ? formatQuantity(r.quantityMilli, r.unit) : ""}`;
  return r.boardTitle ?? "بطاقة حُذفت";
}

function RequestCard({ r, canEdit }: { r: RequestView; canEdit: boolean }) {
  return (
    <li className="flex flex-wrap items-start gap-3 rounded-2xl border border-accent-line bg-raised p-4 shadow-raised">
      <div className="min-w-0 flex-1 basis-60">
        <p className="text-sm font-bold">{KIND[r.kind]} · {r.employeeName}</p>
        <p className="mt-0.5 text-xs text-ink-soft">{summary(r)}{r.kind === "WASTE" && r.wasteReason ? ` · ${WASTE_REASON_LABEL[r.wasteReason as keyof typeof WASTE_REASON_LABEL] ?? r.wasteReason}` : ""}</p>
        {r.kind === "SWAP" && <p className="mt-1 text-[11px] text-muted">باعتماده يعمل {r.employeeName} يومَ راحته ويرتاح {r.withEmployeeName ?? "زميله"}، ويعمل {r.withEmployeeName ?? "زميله"} يومَ راحته ويرتاح {r.employeeName}.</p>}
        {r.kind === "BOARD_EDIT" && (
          <div className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
            <div className="rounded-lg bg-sunken/60 p-2.5"><p className="text-[11px] font-bold text-muted">الآن</p><p className="mt-1 whitespace-pre-line text-xs leading-relaxed">{r.boardBody}</p></div>
            <div className="rounded-lg border border-accent-line bg-accent-soft/30 p-2.5"><p className="text-[11px] font-bold text-accent">المقترح</p><p className="mt-1 whitespace-pre-line text-xs leading-relaxed">{r.proposedBody}</p></div>
          </div>
        )}
        {r.note && <p className="mt-1.5 text-xs">«{r.note}»</p>}
      </div>
      {canEdit && <DecideButtons id={r.id} approveLabel={APPROVE[r.kind]} />}
    </li>
  );
}
