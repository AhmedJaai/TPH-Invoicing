/**
 * يحصل على refresh token لجوجل درايف عبر تدفّق OAuth محلي.
 *
 *   npm run drive:auth            ← صلاحية قراءة فقط (الافتراضي)
 *   npm run drive:auth -- --write ← صلاحية القراءة والكتابة (للمراحل اللاحقة)
 *
 * الافتراضي قراءة فقط عمداً: أدوات الجرد والترحيل لا تحتاج أكثر،
 * ومنع الكتابة تقنياً أأمن من الاعتماد على انضباط الكود.
 */
import http from "node:http";
import { createOAuthClient, DRIVE_SCOPE_FULL, DRIVE_SCOPE_READONLY } from "@/lib/drive";

const PORT = 53682;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;

async function main() {
  const wantsWrite = process.argv.includes("--write");
  const scope = wantsWrite ? DRIVE_SCOPE_FULL : DRIVE_SCOPE_READONLY;

  const client = createOAuthClient(REDIRECT);
  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // إجباري للحصول على refresh token في كل مرة
    scope: [scope, "openid", "email", "profile"],
  });

  console.log(`\nالصلاحية المطلوبة: ${wantsWrite ? "قراءة وكتابة" : "قراءة فقط"}`);
  console.log("\nافتح هذا الرابط في المتصفح وسجّل الدخول بحساب جوجل الذي يملك الأرشيف:\n");
  console.log(url);
  console.log(`\nثم أضف إلى ملف .env سطر GOOGLE_DRIVE_REFRESH_TOKEN الذي سيُطبع هنا.\n`);

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const requestUrl = new URL(req.url ?? "/", REDIRECT);
      if (requestUrl.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const code = requestUrl.searchParams.get("code");
      const error = requestUrl.searchParams.get("error");

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        `<html dir="rtl"><body style="font-family:system-ui;text-align:center;padding:4rem">
         <h2>${code ? "تم — أغلق هذه الصفحة وارجع إلى الطرفية" : "فشل التفويض"}</h2>
         </body></html>`,
      );
      server.close();
      if (code) resolve(code);
      else reject(new Error(error ?? "لم يصل رمز التفويض"));
    });
    server.listen(PORT);
    setTimeout(() => { server.close(); reject(new Error("انتهت المهلة")); }, 5 * 60_000);
  });

  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    console.error("\nلم يصل refresh token. احذف صلاحية التطبيق من حسابك وأعد المحاولة.");
    process.exit(1);
  }

  console.log("\n─────────── أضف هذا السطر إلى .env ───────────\n");
  console.log(`GOOGLE_DRIVE_REFRESH_TOKEN="${tokens.refresh_token}"`);
  console.log(`\nالنطاقات الممنوحة: ${tokens.scope}\n`);
}

main().catch((e) => { console.error("\nخطأ:", e.message); process.exit(1); });
