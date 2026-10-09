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
  /* وكذا لوحةُ رسم الصفحة (`@napi-rs/canvas`): ثنائيٌّ لكلّ منصّة — يُحمَّل ولا يُحزَم */
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas"],

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
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
          /* نافذةٌ فتحها رابطُ درايف لا تمسك بنافذة التطبيق، وملفّاتُه لا يحمّلها موقعٌ آخر */
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://accounts.google.com; object-src 'none'",
          },
          /*
            السياسةُ الأضيق **تُراقَب ولا تمنع** (Report-Only): مصادرُ السكربت والاتّصال
            والصور. ما خالفها يظهر في لوحة المتصفّح ولا ينكسر به شيء؛ وحين تخلو اللوحة
            منه في المعاينة تُنقَل إلى السياسة النافذة أعلاه (بـnonce بدل 'unsafe-inline').
          */
          ...(process.env.NODE_ENV === "production" ? [{
            key: "Content-Security-Policy-Report-Only",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://lh3.googleusercontent.com",
              "font-src 'self' data:",
              "connect-src 'self'",
              "frame-src 'self' blob:",
              "worker-src 'self' blob:",
              "object-src 'none'",
            ].join("; "),
          }] : []),
        ],
      },
    ];
  },
};

export default nextConfig;
