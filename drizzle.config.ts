import "dotenv/config";
import { defineConfig } from "drizzle-kit";

/*
  ── لا `push` ولا `generate` ──

  الهجراتُ SQL صريحٌ في `drizzle/sql/` (`npm run db:migrate`)، وفيها قيودٌ لا يعرفها
  `schema.ts`: فرادةُ هويّة الحركة، وفرادةُ المصروف بحركته، وقيودُ الجرد الجزئيّة،
  ومؤثِّراتُ المال. و`drizzle-kit push` يقابل القاعدةَ بـ`schema.ts` فيُسقط ما لا
  يجده فيه — قيوداً ماليّةً بلا أثرٍ يُراجَع. فيُرفض هنا ولو كُتب بيد.
*/
if (process.argv.some((a) => a === "push" || a === "generate")) {
  throw new Error(
    "drizzle-kit push/generate ممنوع في هذا المستودع: الهجراتُ SQL صريحٌ في drizzle/sql/ (npm run db:migrate) — راجع docs/data-model/migrations.md",
  );
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
  casing: "snake_case",
  verbose: true,
  strict: true,
});
