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
      /*
        نموذجُ زوايا الورقة (١٤ ميجابايت): يُنزَّل مرّةً ويبقى في الجوال — واسمُه بنسخته (`-v1`).
      */
      { source: "/models/:file*", headers: [{ key: "Cache-Control", value: "public, max-age=2592000, immutable" }] },
      /* ملفّاتُ التشغيل باسمٍ ثابت عبر النسخ — يومٌ لا أكثر، فلا يبقى في الجوال نصفٌ قديمٌ ونصفٌ جديد */
      { source: "/ort/:file*", headers: [{ key: "Cache-Control", value: "public, max-age=86400" }] },
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          /* الموقعُ للتطبيق نفسه: رابطُ حضور الموظّف يتحقّق أنّه في المقهى، وصاحبُه يثبّت موقعَه (084) */
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self), payment=(), usb=()" },
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
              /* `wasm-unsafe-eval`: نموذجُ زوايا الورقة يجري بـWebAssembly في عامل الماسح */
              "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://lh3.googleusercontent.com",
              "font-src 'self' data:",
              /* الملفّ الكبير يرفعه المتصفّح إلى Vercel Blob مباشرةً (`/api/upload/blob`) */
              "connect-src 'self' https://vercel.com https://*.blob.vercel-storage.com",
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
