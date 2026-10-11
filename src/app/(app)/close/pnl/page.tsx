import { redirect } from "next/navigation";

/** قائمةُ الدخل انتقلت إلى «المالية» — جوابٌ واحد لسؤال «كم ربحتُ؟» (`/finance`). */
export default async function OldIncomeSheet({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month } = await searchParams;
  redirect(month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? `/finance?month=${month}` : "/finance");
}
