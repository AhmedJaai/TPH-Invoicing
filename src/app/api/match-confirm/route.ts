/**
 * قبول مطابقة، أو إعلان أنّها ليست سداد فاتورة.
 *
 * البابُ وحده: الحارس، وفحصُ الطلب، ونداءٌ واحد لـ`confirmMatch`
 * (`services/match-confirm.service.ts`) — هناك الفروعُ والمعاملات وأسبابُها.
 * وأخطاءُ المال المعروفة (شهرٌ مقفل، حركةٌ قُيّدت بين قراءتها وكتابتها، توأمٌ
 * لم يُقَرّ) يترجمها `respondTo` مرّةً لكلّ المسارات.
 */
import { readJson } from "@/lib/request-body";
import { answer, guard, respondTo } from "@/services/guard";
import { MatchConfirmBody, confirmMatch } from "@/services/match-confirm.service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  /* الطلبُ كلُّه لا الحارسُ وحده: خطأُ عملٍ معروف (شهرٌ مقفل، قيدٌ في القاعدة) يُقال بنصّه لا ٥٠٠ */
  try {
    return await handle(request);
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}

async function handle(request: Request) {
  const user = await guard("match-confirm", "payment:approve");

  const read = await readJson(request, MatchConfirmBody);
  if (!read.ok) return read.response;
  const body = read.body;

  return answer(() => confirmMatch(user.id, body));
}
