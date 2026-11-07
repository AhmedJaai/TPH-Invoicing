/**
 * عددُ طلبات الفريق المنتظرة — وحدَه هنا لا في `team-board.service.ts`، فذاك يستورد خدمةَ الرواتب
 * (الإجازةُ والتبديلُ ينفَّذان بها) وهذا تستورده خدمةُ الرواتب لـ«يحتاج قرارك».
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { pgErrorCode } from "@/lib/pg-error";
import type { Conn } from "./types";

export async function pendingRequestCount(conn: Conn = db): Promise<number> {
  try {
    const r = await conn.execute<{ n: number }>(sql`select count(*)::int as n from team_requests where status = 'PENDING'`);
    return Number(r.rows[0]?.n ?? 0);
  } catch (e) {
    if (pgErrorCode(e) === "42P01") return 0;
    throw e;
  }
}
