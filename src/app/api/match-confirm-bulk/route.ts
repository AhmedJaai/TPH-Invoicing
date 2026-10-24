/**
 * تأكيدٌ جماعيّ لاقتراحات المطابقة.
 *
 * البابُ وحده: الحارس، وفحصُ الطلب، ونداءٌ واحد لـ`confirmMatchesBulk`
 * (`services/match-confirm-bulk.service.ts`). الخادم لا يأخذ من المتصفّح إلّا
 * معرّفات الحركات، ويعيد الحساب على الفواتير كما هي الآن — والتفصيلُ هناك.
 */
import { readJson } from "@/lib/request-body";
import { answer, guard, respondTo } from "@/services/guard";
import { MatchConfirmBulkBody, confirmMatchesBulk } from "@/services/match-confirm-bulk.service";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("match-confirm-bulk", "payment:approve");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const read = await readJson(request, MatchConfirmBulkBody);
  if (!read.ok) return read.response;
  const body = read.body;

  return answer(() => confirmMatchesBulk(user.id, body));
}
