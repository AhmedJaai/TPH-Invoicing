import { redirect } from "next/navigation";
import {
  Archive, FileSearch, FolderSync, History, Inbox, PenLine, ShieldCheck,
} from "lucide-react";
import { signIn } from "@/auth";
import { PageShell } from "@/components/page-shell";
import { DriveSync } from "@/components/drive-sync";
import { DriveRename } from "@/components/drive-rename";
import { EmptyState, KeyFigure, LinkButton, Section, Timeline, type TimelineItem } from "@/components/ui";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { DOCUMENT, FILE, countNoun, timeAgo } from "@/lib/arabic";
import { formatDay, formatMoment } from "@/lib/riyadh-time";
import { DriveSyncNow } from "@/components/drive-sync-now";
import { loadDriveStatus, type DriveStatus } from "@/services/drive-status.service";

export const dynamic = "force-dynamic";

/**
 * الدرايف — جوابُ «هل صارت المزامنةُ والتسميةُ تلقائيّة؟» من الوقائع.
 *
 * كانت أدواتُ الدرايف قسماً أسفل «ارفع مستنداً»، والمزامنةُ تجري وحدها بلا
 * أثرٍ يُرى إلّا إن وجدت جديداً — فسأل صاحبُ المقهى «ما أشوفها، هل صارت
 * تلقائيّة؟» (٢٥ سبتمبر ٢٠٢٦). وهي المرّةُ الثانية: ظنّ قبلها أنّ زرّ
 * المزامنة حُذف لأنّه طُوي. **الفعلُ الذي لا يُرى غيرُ موجود.**
 *
 * فصار للدرايف لسانٌ في «المستندات»، أوّلُه الحال بجملة (يعمل · متوقّف
 * وسببُه · غير موصول · وضعُ التجربة)، ثمّ أربعةُ أرقام، ثمّ كيف يعمل، ثمّ
 * آخرُ ما فعل، ثمّ التحكّمُ اليدويّ لمن لا يريد الانتظار.
 */
export default async function DrivePage() {
  const user = await currentUser();
  if (!user) redirect("/login?from=/documents/drive");
  if (!can(user.role, "document:upload")) redirect("/documents");

  const s = await loadDriveStatus(user.id);
  const n = s.naming;
  const toRename = n.toRenameArchived + n.toRenamePending;

  async function reconnect() {
    "use server";
    await signIn("google", { redirectTo: "/documents/drive" });
  }

  return (
    <PageShell
      user={user}
      width="wide"
      title="الدرايف"
      intro="أرشيفُ المقهى في جوجل درايف: يُقرأ الجديدُ منه وحده، ويُسمّى المؤرشَفُ على الصيغة وحده. هنا حالُه وما فعله — والتحكّمُ اليدويّ إن لم ترد الانتظار."
    >
      <DriveSyncNow {...statusCopy(s)} state={s.state} facts={syncFacts(s)} reconnect={reconnect} />

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
        <KeyFigure
          icon={Archive}
          label="في الأرشيف"
          href="/documents"
          value={<span className="nums">{s.fromDrive}</span>}
          sub={
            s.lastArrivalAt
              ? `آخرُها دخل ${formatDay(s.lastArrivalAt)}${s.arrivedLast7Days > 0 ? ` · هذا الأسبوع ${countNoun(s.arrivedLast7Days, DOCUMENT)}` : " · لا جديد هذا الأسبوع"}`
              : "لم يدخل مستندٌ بعد."
          }
        />
        <KeyFigure
          icon={Inbox}
          label="ينتظر مراجعتك"
          href="/documents?status=NEEDS_REVIEW"
          tone={s.waitingReview > 0 ? "warn" : undefined}
          value={<span className="nums">{s.waitingReview}</span>}
          sub={s.waitingReview > 0 ? "لم تجتمع فيه شروطُ الأرشفة الآليّة — ولا يُسمّى حتى يُعتمَد." : "كلُّ ما وصل حُسم."}
        />
        <KeyFigure
          icon={PenLine}
          label="على الصيغة"
          tone={n.known > 0 && toRename === 0 ? "ok" : undefined}
          value={
            n.known === 0
              ? <span className="text-[1.35rem] text-muted">غير معروف</span>
              : <span className="nums">{n.onStandard}<span className="text-base text-muted"> / {n.known}</span></span>
          }
          sub={
            n.known === 0
              ? "لا ملفَّ مسجّلاً بعد."
              : [
                  n.toRenameArchived > 0
                    ? `${s.writesAllowed ? "للتسمية في الاستدراك القادم" : "للتسمية من الإنتاج وحده"}: ${countNoun(n.toRenameArchived, FILE)}`
                    : null,
                  n.toRenamePending > 0 ? `بعد اعتمادها: ${countNoun(n.toRenamePending, FILE)}` : null,
                  n.cannot > 0 ? `ينقصها ما يُبنى به الاسم: ${countNoun(n.cannot, FILE)}` : null,
                ].filter(Boolean).join(" · ") || "كلُّ ما نعرفه على الصيغة."
          }
        />
      </div>

      <div className="mt-10 grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Section title="كيف يعمل" icon={FolderSync} className="mt-0!" hint="بلا زرٍّ تضغطه — ما دام التطبيق مفتوحاً عند أحدكم.">
          <Timeline items={HOW_IT_WORKS} />
        </Section>

        <Section
          title="آخرُ ما فعله"
          icon={History}
          className="mt-0!"
          action={can(user.role, "audit:view") ? <LinkButton href="/settings/audit?kind=documents" size="sm" variant="quiet">سجلُّ التدقيق</LinkButton> : undefined}
        >
          {s.recent.length > 0 ? (
            <Timeline items={s.recent.map(activityItem)} />
          ) : (
            <EmptyState
              compact
              icon={History}
              title="لم يُسجَّل بعدُ ما فعله الدرايف."
              hint="يُكتب هنا كلُّ مزامنةٍ وجدت جديداً وكلُّ تسميةٍ وقعت — بالاسمين."
            />
          )}
        </Section>
      </div>

      <Section
        id="manual"
        title="أدواتٌ مفصّلة"
        icon={FileSearch}
        hint="«زامن الآن» أعلاه يفعل كلَّ شيء. وهنا لمن يريد أن يرى قبل أن يُسجَّل شيء: ما الجديد في الدرايف، وما سيُسمّى — ويختار ملفّاً ملفّاً."
        className="mt-12"
      >
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
          <DriveSync />
          <DriveRename />
        </div>
      </Section>
    </PageShell>
  );
}

const HOW_IT_WORKS: TimelineItem[] = [
  {
    id: "scan",
    icon: FolderSync,
    title: "يفحص الدرايف كلَّ ثلاث ساعات",
    body: "مجلّداتِ الشهرين الأخيرين، ويأخذ ما لم يُسجَّل من قبل. وتقع المزامنةُ حين يكون التطبيق مفتوحاً عند المالك أو من له صلاحيةُ الرفع — فإن لم يفتحه أحدٌ انتظرت أوّلَ فتح.",
  },
  {
    id: "read",
    icon: FileSearch,
    title: "يقرأ الجديد ويقيّد ما يطمئنّ إليه",
    body: "ما اجتمعت فيه شروطُ الأرشفة الآليّة الأربعة يُقيَّد وحده، وما عداه ينتظر مراجعتك في «المستندات» بسببه.",
  },
  {
    id: "rename",
    icon: PenLine,
    title: "يسمّي المؤرشَف على الصيغة",
    body: "كلَّ عشر دقائق: خمسةٌ وعشرون ملفّاً في كلّ مرّة، من البيانات المقيَّدة وحدها، والاسمان في سجلّ التدقيق. وما ينتظر المراجعة لا يُسمّى حتى يُعتمَد.",
  },
  {
    id: "safe",
    icon: ShieldCheck,
    tone: "ok",
    title: "لا حذفَ ولا نقل — أبداً",
    body: "التسميةُ هي الكتابةُ الوحيدة على الدرايف، ولا تقع إلّا من التطبيق الحقيقيّ — لا من نسخ التجربة.",
  },
];

function activityItem(a: DriveStatus["recent"][number]): TimelineItem {
  const who = a.actor && a.actor !== "وضع التجربة" ? ` · ${a.actor}` : "";
  if (a.kind === "RENAMED") {
    return {
      id: a.id,
      icon: PenLine,
      title: `سُمّي ${countNoun(a.count, FILE)} على الصيغة`,
      meta: `${timeAgo(a.at)}${who}`,
      body: a.lines.length > 0 ? (
        <ul className="space-y-1.5">
          {a.lines.slice(0, 3).map((l) => {
            /* «القديم ← الجديد» كما كُتب في الأثر — يُعرض سطرين لا سهماً يقلبه اتّجاهُ الاسم اللاتينيّ */
            const [from, to] = l.split(" ← ");
            return (
              <li key={l} className="min-w-0">
                <span dir="ltr" className="block truncate text-end text-[11px] text-muted line-through">{from}</span>
                {to && <span dir="ltr" className="block truncate text-end text-[11px] font-bold text-ink-soft">{to}</span>}
              </li>
            );
          })}
          {a.lines.length > 3 && <li className="text-[11px] text-muted">و{countNoun(a.lines.length - 3, FILE)} غيرها في سجلّ التدقيق.</li>}
        </ul>
      ) : undefined,
    };
  }
  return {
    id: a.id,
    icon: FolderSync,
    tone: "ok",
    title: `دخل من الدرايف ${countNoun(a.count, DOCUMENT)}`,
    meta: `${timeAgo(a.at)}${who}`,
  };
}

/** الحالُ بجملة، وسببُها — بالحكم الواحد (`driveState`). */
function statusCopy(s: DriveStatus): { headline: string; detail: string } {
  switch (s.state) {
    case "preview":
      return {
        headline: "نسخةُ تجربة: الدرايف غير موصول هنا — عمداً",
        detail: "تدخل هذه النسخةَ بلا تسجيل دخول، فلا تستعير تفويضَ درايف المالك كي لا يُكتب في الأرشيف الحقيقيّ. الأرقامُ أدناه من نسخة البيانات.",
      };
    case "disconnected":
      return {
        headline: "الدرايف غير موصول بحسابك",
        detail: "لا تفويضَ درايف محفوظٌ لحسابك، فلا مزامنةَ ولا تسمية. أعد الربط ووافق على صلاحية الدرايف في صفحة جوجل.",
      };
    case "failing":
      return {
        headline: `توقّفت المزامنة ${s.failure ? timeAgo(s.failure.at) : ""}`.trim(),
        detail: s.failure?.reason ?? "تعذّر الفحص.",
      };
    case "unchecked":
      return {
        headline: "لم تُسجَّل مزامنةٌ بعد",
        detail: "تقع وحدها في الدقائق الأولى من فتح التطبيق ثمّ كلَّ ثلاث ساعات — أو اضغط «زامن الآن».",
      };
    case "ok":
      return {
        headline: "المزامنةُ تعمل وحدها",
        detail: s.writesAllowed
          ? "كلَّ ثلاث ساعات والتطبيقُ مفتوح، والتسميةُ كلَّ عشر دقائق. لا حاجةَ لزرّ — إلّا إن وضعتَ ملفّاً الآن ولا تريد الانتظار."
          : "والتسميةُ موقوفةٌ في هذه البيئة — تقع من الإنتاج وحده، فالأرشيف واحدٌ لا نسخةَ له.",
      };
  }
}

/** متى بالضبط — بتوقيت الرياض، و«منذ» تحته. */
function syncFacts(s: DriveStatus): { label: string; value: string; hint?: string }[] {
  return [
    {
      label: "آخرُ مزامنة",
      value: s.checkedAt ? formatMoment(s.checkedAt) : "لم تُسجَّل بعد",
      hint: s.checkedAt ? timeAgo(s.checkedAt) : "تُسجَّل أوّلَ ما يُفحص الدرايف",
    },
    {
      label: "آخرُ مرّةٍ وجدت جديداً",
      value: s.lastFoundAt ? formatMoment(s.lastFoundAt) : "لم تجد بعد",
      hint: s.lastArrivalAt ? `آخرُ مستندٍ دخل الأرشيف ${formatDay(s.lastArrivalAt)}` : undefined,
    },
    {
      label: "آخرُ تسمية",
      value: s.lastRenamedAt ? formatMoment(s.lastRenamedAt) : "لم تقع بعد",
      hint: s.writesAllowed ? "تعمل وحدها كلَّ عشر دقائق" : "من الإنتاج وحده",
    },
  ];
}
