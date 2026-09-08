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
};

export default nextConfig;
