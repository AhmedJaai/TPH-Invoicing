/**
 * إدارةُ المستخدمين — للمالك وحده (`users:manage`).
 *
 *   POST { userId, action: "role", role } | { userId, action: "active", active } | { userId, action: "end-sessions" }
 *
 * الخادمُ يقرّر: لا يُنزل المالكُ نفسَه ولا يعطّلها، ولا يُترك النظامُ بلا مالكٍ يدخل.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { ROLES } from "@/lib/permissions";
import { failWith, guard, pgErrorCode, respondTo } from "@/services/guard";
import { applyUserChange, UserChangeRefused } from "@/services/user-admin.service";

export const runtime = "nodejs";

const UserId = z.string().min(1).max(64);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("role"), userId: UserId, role: z.enum(ROLES) }).strict(),
  z.object({ action: z.literal("active"), userId: UserId, active: z.boolean() }).strict(),
  z.object({ action: z.literal("end-sessions"), userId: UserId }).strict(),
]);

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("users", "users:manage");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const read = await readJson(request, Body);
  if (!read.ok) return read.response;
  const body = read.body;

  try {
    const result = await applyUserChange(
      user.id,
      body.userId,
      body.action === "role" ? { kind: "role", role: body.role }
        : body.action === "active" ? { kind: "active", active: body.active }
          : { kind: "end-sessions" },
    );
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof UserChangeRefused) return NextResponse.json({ error: e.message }, { status: 400 });
    /* قيمةٌ لا يعرفها نوعُ `role` في القاعدة: هجرةُ الدور الجديد لم تُطبَّق بعد */
    if (pgErrorCode(e) === "22P02") {
      return NextResponse.json({ error: "هذا الدور لم يُضف إلى القاعدة بعد — تُطبَّق هجرتُه ثمّ يُعاد. لم يتغيّر شيء" }, { status: 409 });
    }
    return failWith(e, "users");
  }
}
