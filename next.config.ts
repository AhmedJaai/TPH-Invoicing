import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
    `pdfjs-dist` يُحمَّل من `node_modules` ولا يُحزَم.

    حزمُه يكسر قراءة الـPDF في الإنتاج وحده: المكتبة تستورد عاملَها
    (`pdf.worker.mjs`) استيراداً ديناميكياً، والحازم لا يتتبّع ذلك
    فلا يُنسَخ الملفّ. فيقول الخادم:

      Setting up fake worker failed: Cannot find module
      '/var/task/.next/server/chunks/pdf.worker.mjs'

    ويسقط استخراجُ النصّ كلّه — ومعه المسار الأرخص والأدقّ في قراءة
    الفواتير، فتتحوّل كلّها إلى «لم تُقرأ». ولا يظهر محلّياً لأنّ
    `node_modules` حاضرة.
  */
  serverExternalPackages: ["pdfjs-dist"],

  /*
    ترويساتُ الأمان — لم يكن منها شيء.

    صفحاتٌ تحمل الحسابات والرواتب والكشوف: لا تُؤطَّر في موقعٍ آخر
    (نقرُ «سدِّد» خلف طبقةٍ شفّافة)، ولا يُخمَّن نوعُ ملفٍّ مرفوع، ولا
    يُرسَل رابطُ الصفحة كاملاً إلى موقعٍ خارجيّ. وسياسة المحتوى تبدأ
    بالإطار والنماذج وحدها — الأضيق يُجرَّب في المعاينة قبل الإنتاج.
  */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://accounts.google.com; object-src 'none'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
