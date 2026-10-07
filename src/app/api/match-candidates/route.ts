/**
 * مرشّحو حركةٍ واحدة — ليُختار بينهم.
 *
 * «مرشّحان متقاربان» كانت تُعرَض بسببها وحده: لا الفاتورتان جنباً إلى جنب
 * ولا وسيلةَ لاختيار إحداهما. والمرشّحون لا يُحفَظون مع الحركة عمداً —
 * ما حُسب لحظةَ الاستيراد قد سُدّدت فاتورتُه بعده — فيُحسَبون هنا **الآن**
 * على الفواتير كما هي، وهي القائمةُ نفسها التي يتحقّق منها الإقرار.
 *
 * قراءةٌ لا تكتب شيئاً.
 */
import { z } from "zod";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bankTransactions } from "@/db/schema";
import { readJson } from "@/lib/request-body";
import { guard, respondTo } from "@/services/guard";
import { MAX_SHOWN_CANDIDATES, candidateKey, recomputeMatches } from "@/services/match-recompute.service";

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

  const [tx] = await db
    .select()
    .from(bankTransactions)
    .where(eq(bankTransactions.id, read.body.transactionId));
  if (!tx) return NextResponse.json({ error: "لا توجد هذه الحركة" }, { status: 404 });
  if (tx.matchedPaymentId) {
    return NextResponse.json({ error: "هذه الحركة سُجّلت سداداً من قبل" }, { status: 409 });
  }

  const { engine, invoiceById } = await recomputeMatches([tx]);
  const result = engine.results.find((r) => r.key === tx.id);
  const settled = result?.candidate ? candidateKey(result.candidate.invoiceIds) : null;
  const top = (engine.candidatesByKey.get(tx.id) ?? []).slice(0, MAX_SHOWN_CANDIDATES);

  return NextResponse.json({
    ok: true,
    transactionId: tx.id,
    amountMinor: tx.amountMinor,
    supplierId: result?.supplierId ?? null,
    candidates: top.map((c) => ({
      key: candidateKey(c.invoiceIds),
      invoiceIds: c.invoiceIds,
      /* ما رسا عليه المحرّك — يُعلَّم ولا يُفرَض */
      recommended: candidateKey(c.invoiceIds) === settled,
      outcome: c.outcome,
      score: Math.round(c.score * 100),
      /* الأبعادُ الأربعة من مئة — المرجعُ `null` حين لا يُقاس، لا صفراً */
      parts: {
        supplier: Math.round(c.parts.supplier * 100),
        amount: Math.round(c.parts.amount * 100),
        date: Math.round(c.parts.date * 100),
        reference: c.parts.reference > 0 ? Math.round(c.parts.reference * 100) : null,
      },
      allocatedMinor: c.allocatedMinor,
      evidence: c.evidence,
      invoices: c.invoiceIds.map((id) => {
        const inv = invoiceById.get(id);
        return {
          id,
          number: inv?.invoiceNumber ?? null,
          date: inv ? inv.invoiceDate.toISOString() : null,
          totalMinor: inv?.totalMinor ?? null,
          outstandingMinor: inv?.outstandingMinor ?? null,
        };
      }),
    })),
  });
}
