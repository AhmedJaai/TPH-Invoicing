/**
 * ميزانيةُ الشهر لباب — صفٌّ جديد يسري من شهر (111). المبلغُ نصٌّ بالريال يحوّله الخادمُ هللات،
 * والفارغُ يُلغي ميزانية الباب من ذلك الشهر. ولا يمسّ دفتراً.
 */
import { z } from "zod";
import { NextResponse, after } from "next/server";
import { readJson } from "@/lib/request-body";
import { failWith, guard } from "@/services/guard";
import { parseRiyals } from "@/lib/money";
import { formatMonth } from "@/lib/riyadh-time";
import { BUDGET_LINES, budgetLabel, refreshBudgetFindings, setBudget } from "@/services/budget.service";

export const runtime = "nodejs";

const Body = z.object({
  line: z.enum(BUDGET_LINES),
  /** بالريال نصّاً؛ `null` أو فارغٌ يُلغي. */
  amount: z.string().trim().max(20).nullable(),
  fromMonth: z.string().regex(/^\d{4}-\d{2}$/, "اكتب الشهر بصيغة YYYY-MM"),
  note: z.string().max(300).optional(),
});

export async function POST(request: Request) {
  try {
    const user = await guard("budget", "expense:edit");
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const { line, amount, fromMonth, note } = read.body;
    const amountMinor = amount === null || amount === "" ? null : parseRiyals(amount);
    if (amount !== null && amount !== "" && (amountMinor === null || amountMinor <= 0)) {
      return NextResponse.json({ error: "المبلغ غير مفهوم. اكتبه بالريال، مثل 3000 أو 2500.50" }, { status: 400 });
    }
    await setBudget(user.id, { line, amountMinor, fromMonth, note: note?.trim() || null });
    /* التنبيهُ يتبع الحدَّ الجديد بعد الردّ لا صباحَ الغد — وتعذّرُه لا يُسقط ما حُفظ */
    after(() => refreshBudgetFindings().then(() => undefined, () => undefined));
    return NextResponse.json({
      ok: true,
      message: amountMinor === null ? `أُلغيت ميزانية «${budgetLabel(line)}» من ${formatMonth(fromMonth)}` : `حُفظت ميزانية «${budgetLabel(line)}» من ${formatMonth(fromMonth)}`,
    });
  } catch (e) {
    return failWith(e, "budget");
  }
}
