/**
 * تأكيد جهةٍ من حركة.
 *
 * وهو المسار الذي يجعل النظام يتعلّم: يقول صاحب العمل «هذه المراعي»
 * مرّةً، فتُستخرَج من الحركة كلّ أدلّتها — الاسم والحساب والهوية —
 * وتُنسَب إليها. فما بعدها يُعرَف بلا سؤال.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bankTransactions, counterparties } from "@/db/schema";
import { guard, respondTo } from "@/services/guard";
import { confirmCounterparty } from "@/services/counterparty.service";
import { toCanonical } from "@/lib/bank/canonical";
import type { TxCategory } from "@/lib/bank/rules";

export const runtime = "nodejs";

const KINDS: readonly TxCategory[] = [
  "SUPPLIER", "SALARY", "RENT", "ZAKAT", "UTILITY", "GOVERNMENT",
  "PERSONAL", "INTERNAL", "OTHER", "BANK_FEE",
];

interface Body {
  transactionId?: string;
  counterpartyId?: string;
  displayName?: string;
  kind?: TxCategory;
  supplierId?: string | null;
}

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("counterparty", "bank:edit");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }

  if (!body.transactionId) {
    return NextResponse.json({ error: "حدّد الحركة" }, { status: 400 });
  }
  if (!body.kind || !KINDS.includes(body.kind)) {
    return NextResponse.json({ error: "اختر باباً صالحاً" }, { status: 400 });
  }
  if (body.kind === "SUPPLIER" && !body.supplierId) {
    return NextResponse.json(
      { error: "سداد المورّد يحتاج تحديد المورّد" },
      { status: 400 },
    );
  }

  const [tx] = await db
    .select()
    .from(bankTransactions)
    .where(eq(bankTransactions.id, body.transactionId));

  if (!tx) return NextResponse.json({ error: "لا توجد هذه الحركة" }, { status: 404 });

  const canonical = toCanonical({
    valueDate: tx.valueDate,
    description: tx.description,
    beneficiaryRaw: tx.beneficiaryRaw,
    transactionType: tx.transactionType,
    amountMinor: tx.amountMinor,
    direction: tx.direction as "DEBIT" | "CREDIT",
  });

  const result = await confirmCounterparty({
    userId: user.id,
    counterpartyId: body.counterpartyId,
    displayName: body.displayName,
    kind: body.kind,
    supplierId: body.supplierId,
    transaction: canonical,
  });

  // تُنسَب الحركة إلى جهتها فوراً، ويُصحَّح بابها
  await db
    .update(bankTransactions)
    .set({
      counterpartyId: result.counterpartyId,
      category: body.kind,
      supplierId: body.supplierId ?? null,
    })
    .where(eq(bankTransactions.id, tx.id));

  const [party] = await db
    .select({ name: counterparties.displayName })
    .from(counterparties)
    .where(eq(counterparties.id, result.counterpartyId));

  return NextResponse.json({
    ok: true,
    ...result,
    message:
      result.conflicts.length > 0
        ? `حُفظت «${party?.name}» — و${result.conflicts.length} دليلاً يدلّ على جهةٍ أخرى، راجعها`
        : `حُفظت «${party?.name}» بـ${result.added.length} دليلاً — ما يشبهها يُعرَف تلقائياً`,
  });
}
