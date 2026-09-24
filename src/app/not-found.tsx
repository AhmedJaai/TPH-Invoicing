import Link from "next/link";

/** رابطٌ قديم أو مورّدٌ دُمج — بالعربية، ومعه طريقُ الرجوع. */
export default function NotFound() {
  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <title>لم نجد هذه الصفحة · ذا بوبليك هاوس</title>
      <div className="rounded-2xl border border-line bg-raised px-5 py-8 text-center shadow-raised">
        <h1 className="text-lg font-bold">لم نجد هذه الصفحة</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-soft">
          قد يكون الرابط قديماً، أو المورّد دُمج في غيره فتغيّر رمزه. ابحث عمّا تريد من أيّ
          صفحة: «ابحث أو انتقل» في الشريط، أو <kbd className="rounded border border-line px-1 text-xs">/</kbd>.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center rounded-lg bg-inverse-surface px-4 text-sm font-bold text-inverse-ink sm:min-h-9"
          >
            الرئيسية
          </Link>
          <Link
            href="/suppliers"
            className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-sm sm:min-h-9"
          >
            المورّدون
          </Link>
        </div>
      </div>
    </main>
  );
}
