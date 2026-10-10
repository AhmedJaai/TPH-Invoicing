"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { ROLE_LABEL, ROLES, type Role } from "@/lib/permissions";
import { buttonClass } from "./ui-tokens";
import { Badge } from "./ui";
import { ConfirmAction, toast } from "./ui-client";

export interface UserAdminItem {
  id: string;
  name: string | null;
  email: string;
  role: Role;
  isActive: boolean;
  activeSessions: number;
  /** متى جُدّدت جلستُه آخرَ مرّة («قبل ساعتين») — أو `null`: لا جلسةَ قائمة. */
  lastSeenAbout: string | null;
  note: string | null;
}

interface Answer { message?: string; signedOutSelf?: boolean }

/**
 * المستخدمون: دورُ كلٍّ منهم، وحسابُه، وجلساتُه — للمالك وحده.
 *
 * الخادمُ يقرّر ما يُقبل (`lib/user-admin.ts`)؛ والشاشةُ لا تعرض على المالك ما يحبسه
 * خارج نظامه: لا يغيّر دورَه ولا يعطّل نفسَه من هنا.
 */
export function UserAdmin({ users, meId }: { users: UserAdminItem[]; meId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function send(userId: string, body: Record<string, unknown>, failed: string): Promise<boolean> {
    setBusy(userId);
    const res = await postJson<Answer>("/api/users", { userId, ...body });
    setBusy(null);
    if (!res.ok) {
      toast({ tone: "danger", title: failed, body: res.error });
      return false;
    }
    toast({ tone: "ok", title: res.data.message ?? "تمّ" });
    if (res.data.signedOutSelf) router.push("/login");
    else router.refresh();
    return true;
  }

  return (
    <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
      {users.map((u) => {
        const me = u.id === meId;
        const working = busy === u.id;
        return (
          <li key={u.id} className="space-y-3 px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold">
                  {u.name ?? u.email}{me ? " (أنت)" : ""}
                </span>
                <bdi dir="ltr" className="block truncate text-[11px] text-muted">{u.email}</bdi>
              </span>
              <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                <Badge tone={u.isActive ? "ok" : "danger"} dot>{u.isActive ? "مفعَّل" : "معطَّل"}</Badge>
                <Badge>{ROLE_LABEL[u.role]}</Badge>
              </span>
            </div>

            <p className="text-[11px] leading-relaxed text-muted">
              {u.activeSessions === 0
                ? "لا جلسةَ قائمة — آخرُ نشاطه غير معروف"
                : <>جلساتٌ قائمة: <span className="nums">{u.activeSessions}</span> · آخرُ تجديدٍ لجلسته {u.lastSeenAbout ?? "غير معروف"} (تُجدَّد مرّةً في اليوم ما دام يستعمل النظام)</>}
            </p>

            {u.note && (
              <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-warn">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                <span>{u.note}</span>
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {!me && (
                <label className="flex items-center gap-2 text-xs text-ink-soft">
                  <span>الدور</span>
                  <select
                    value={u.role}
                    disabled={working}
                    aria-busy={working}
                    onChange={(e) => {
                      const role = ROLES.find((r) => r === e.target.value);
                      if (role && role !== u.role) void send(u.id, { action: "role", role }, "لم يتغيّر الدور");
                    }}
                    className="min-h-11 rounded-lg border border-line-input bg-raised px-2 text-sm sm:min-h-9"
                  >
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                </label>
              )}

              {u.activeSessions > 0 && (
                <ConfirmAction
                  label={me ? "أنهِ جلساتي على كلّ الأجهزة" : "أنهِ جلساته"}
                  title={me ? "إنهاءُ جلساتك كلِّها" : `إنهاءُ جلسات ${u.name ?? u.email}`}
                  consequence={me
                    ? "تخرج من هذا الجهاز ومن كلّ جهازٍ دخلتَ منه، ثمّ تدخل من جديد بجوجل. نافعٌ إن ضاع جهازٌ أو بقيتَ داخلاً على جهازٍ مشترك."
                    : "يخرج من كلّ أجهزته الآن، ويدخل من جديد بجوجل إن بقي حسابُه مفعَّلاً."}
                  acknowledgement={me ? "أعرف أنّي سأدخل من جديد" : "أعرف أنّه سيُخرَج الآن"}
                  confirmLabel="أنهِ الجلسات"
                  tone="warn"
                  variant="secondary"
                  disabled={working}
                  onConfirm={() => send(u.id, { action: "end-sessions" }, "لم تُنهَ الجلسات")}
                />
              )}

              {!me && (u.isActive ? (
                <ConfirmAction
                  label="عطّل حسابه"
                  title={`تعطيلُ ${u.name ?? u.email}`}
                  consequence="يُخرَج من كلّ أجهزته الآن ولا يدخل حتى تُعيد تفعيلَه. ما كتبه يبقى باسمه في سجلّ التدقيق."
                  acknowledgement="أعرف أنّه لن يدخل حتى أُعيد تفعيلَه"
                  confirmLabel="عطّله"
                  disabled={working}
                  onConfirm={() => send(u.id, { action: "active", active: false }, "لم يُعطَّل الحساب")}
                />
              ) : (
                <button
                  type="button"
                  disabled={working}
                  aria-busy={working}
                  className={buttonClass("secondary", "sm")}
                  onClick={() => void send(u.id, { action: "active", active: true }, "لم يُفعَّل الحساب")}
                >
                  أعِد تفعيلَه
                </button>
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
