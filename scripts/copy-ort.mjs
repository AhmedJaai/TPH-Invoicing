/**
 * ملفّاتُ تشغيل نموذج زوايا الورقة في المتصفّح (onnxruntime-web، رخصة MIT) — تُنسخ من
 * الحزمة المثبَّتة إلى `public/ort/` بعد كلّ تثبيت، فتُخدم من موقعنا (`'self'`) لا من
 * خدمةٍ خارجيّة، وتبقى نسختُها نسخةَ الحزمة. وليست في المستودع (`.gitignore`).
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";

const from = "node_modules/onnxruntime-web/dist";
const to = "public/ort";
const files = ["ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.mjs"];

if (!existsSync(from)) {
  console.warn("[copy-ort] onnxruntime-web غير مثبَّت — يُتخطّى");
  process.exit(0);
}
mkdirSync(to, { recursive: true });
for (const f of files) copyFileSync(`${from}/${f}`, `${to}/${f}`);
console.log(`[copy-ort] نُسخت ${files.length} ملفّات إلى ${to}`);
