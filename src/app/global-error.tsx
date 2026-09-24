"use client";

/**
 * حين يسقط التخطيط نفسه — فلا قشرة ولا خطوط ولا ألوان من `globals.css`.
 * لذلك الأنماط مضمَّنة، والنصّ بالعربية.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="ar" dir="rtl">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: "4rem 1rem", background: "#f6f4ef", color: "#1b1a17" }}>
        <main style={{ maxWidth: "28rem", margin: "0 auto", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.15rem" }}>تعذّر تشغيل التطبيق</h1>
          <p style={{ fontSize: "0.9rem", lineHeight: 1.7, color: "#57534b" }}>
            لم يُكتب شيء. أعد المحاولة بعد لحظة، فإن تكرّر فانقل الرمز أدناه لمن يصلحه.
          </p>
          {error.digest && <p dir="ltr" style={{ fontSize: "0.75rem", color: "#6d685e" }}>{error.digest}</p>}
          <button
            type="button"
            onClick={() => retry()}
            style={{ marginTop: "1rem", padding: "0.6rem 1.2rem", borderRadius: "0.5rem", border: 0, background: "#0f6b58", color: "#fff", fontWeight: 700 }}
          >
            أعد المحاولة
          </button>
        </main>
      </body>
    </html>
  );
}
