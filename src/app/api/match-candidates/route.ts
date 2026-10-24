/**
 * مرشّحو حركةٍ واحدة — ليُختار بينهم.
 *
 * البابُ وحده: الحارس، وفحصُ الطلب، ونداءٌ واحد لـ`matchCandidates`
 * (`services/match-recompute.service.ts`) — يُحسَبون الآن على الفواتير كما هي،
 * وهي القائمةُ نفسها التي يتحقّق منها الإقرار. قراءةٌ لا تكتب شيئاً.
 */
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { answer, guard, respondTo } from "@/services/guard";
import { matchCandidates } from "@/services/match-recompute.service";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  transactionId: z.string().trim().min(1).max(64),
});

export async function POST(request: Request) {
  try {
    await guard("match-candidates", "payment:approve");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const read = await readJson(request, Body);
  if (!read.ok) return read.response;
  const transactionId = read.body.transactionId;

  return answer(() => matchCandidates(transactionId));
}
