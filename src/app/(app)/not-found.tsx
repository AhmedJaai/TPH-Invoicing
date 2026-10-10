import Link from "next/link";
import { Compass } from "lucide-react";
import { mainClass } from "@/components/page-shell";
import { OpenSearchButton } from "@/components/shell-context";
import { Kbd } from "@/components/ui";
import { buttonClass } from "@/components/ui-tokens";

/**
 * «لم نجد هذه الصفحة» **داخل القشرة** — رابطُ مورّدٍ دُمج أو فاتورةٍ حُذفت.
 *
 * كانت تُرسَم من جذر التطبيق: بطاقةٌ في صفحةٍ بلا شريطٍ ولا بحث، ونصُّها يقول
 * «ابحث بـ⌘K» واللوحةُ غيرُ مركَّبةٍ هناك. فهنا يبقى التنقّلُ كلُّه، والبحثُ زرٌّ يعمل.
 */
export default function NotFound() {
  return (
    <main id="main" className={mainClass("form")}>
      <title>لم نجد هذه الصفحة · ذا بوبليك هاوس</title>
      <div className="rounded-2xl border border-line bg-raised px-6 py-10 text-center shadow-raised">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-accent-soft text-accent">
          <Compass className="h-6 w-6" strokeWidth={1.75} aria-hidden />
        </span>
        <h1 className="mt-4 text-lg font-bold">لم نجد هذه الصفحة</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-soft">
          قد يكون الرابط قديماً، أو المورّد دُمج في غيره فتغيّر رمزه، أو السجلُّ لم يعد قائماً.
          ابحث عنه باسمه أو رقمه أو مبلغه — <Kbd>⌘K</Kbd> أو <Kbd>/</Kbd> من أيّ صفحة.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <OpenSearchButton>ابحث عنه</OpenSearchButton>
          <Link href="/" className={buttonClass("secondary")}>
            إلى اليوم
          </Link>
        </div>
      </div>
    </main>
  );
}
