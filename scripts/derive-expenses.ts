/**
 * يقيّد المصروفات الفعلية من حركات البنك المصنَّفة.
 *
 * قابل لإعادة التشغيل بلا ضرر: الحركة المقيَّدة لا تُقيَّد ثانيةً —
 * يحرسه فهرس فريد في القاعدة لا هذه الشيفرة.
 *
 *   npm run db:expenses            كل الشهور
 *   npm run db:expenses 2026-08    شهراً بعينه
 */
import { deriveExpensesFromBank } from "../src/services/expense.service";

async function main() {
  const month = process.argv[2]?.match(/^\d{4}-\d{2}$/) ? process.argv[2] : undefined;
  const r = await deriveExpensesFromBank(null, month);

  console.log(`  المفحوصة: ${r.scanned}`);
  console.log(`  المقيَّدة: ${r.created} · منها مربوطة بمتوقَّع: ${r.linkedToRecurring}`);
  console.log(`  مقيَّدة من قبل: ${r.skippedAlreadyRecorded}`);
  console.log(`  ليست مصروفاً (سداد مورّد أو داخلية أو شخصية أو مجهولة): ${r.skippedNotExpense}`);
  console.log(
    `  وصفها يقول شراء بضاعة فاستُبعدت: ${r.skippedGoodsPurchase}` +
    ` (${(r.goodsPurchaseMinor / 100).toFixed(2)} ريال)`,
  );
  process.exit(0);
}

main();
