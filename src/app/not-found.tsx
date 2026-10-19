import Link from "next/link";
import { Compass } from "lucide-react";
import { buttonClass } from "@/components/ui-tokens";
import { Kbd } from "@/components/ui";
import { T } from "@/components/i18n/t";

/** رابطٌ قديم أو مورّدٌ دُمج — بالعربية، ومعه طريقُ الرجوع. */
export default function NotFound() {
  return (
    <main className="mx-auto max-w-lg px-4 py-16 sm:py-24">
      <title>لم نجد هذه الصفحة · ذا بوبليك هاوس</title>
      <div className="rounded-2xl border border-line bg-raised px-6 py-10 text-center shadow-lifted">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-accent-soft text-accent">
          <Compass className="h-6 w-6" strokeWidth={1.75} aria-hidden />
        </span>
        <h1 className="mt-4 text-lg font-bold">لم نجد هذه الصفحة</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-soft">
          <T s="ربما الرابط قديم، أو دُمج المورّد في غيره فتغيّر رمزه. ابحث عما تريد من أي صفحة بـ{0} أو {1}." a={[<Kbd key="0">⌘K</Kbd>, <Kbd key="1">/</Kbd>]} /></p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link href="/" className={buttonClass("primary")}>
            العودة إلى اليوم
          </Link>
          <Link href="/suppliers" className={buttonClass("secondary")}>
            المورّدون
          </Link>
        </div>
      </div>
    </main>
  );
}
