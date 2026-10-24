/**
 * التراجع عن مطابقة.
 *
 * البابُ وحده: الحارس، وفحصُ الطلب، ونداءٌ واحد لـ`undoMatch`
 * (`services/match-undo.service.ts`). والدفعةُ تُردّ لا تُحذف — والتفصيلُ هناك.
 */
import { readJson } from "@/lib/request-body";
import { answer, guard, respondTo } from "@/services/guard";
import { MatchUndoBody, undoMatch } from "@/services/match-undo.service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let user;
  try {
    /* الردّ فكُّ مالٍ عن فواتير — بصلاحية من يقيّده، لا بصلاحية التصنيف */
    user = await guard("match-undo", "payment:approve");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const read = await readJson(request, MatchUndoBody);
  if (!read.ok) return read.response;
  const body = read.body;

  return answer(() => undoMatch(user.id, body));
}
