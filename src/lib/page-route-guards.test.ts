import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * كلُّ صفحةٍ يبلغها عنوان — بحكم Next نفسه لا بظنّنا.
 *
 * ── العطب الذي أنشأ هذا الملفّ (١ نوفمبر ٢٠٢٦) ──
 *
 * ترقيةُ Next من 16.3.4 إلى 16.4.3 (لثغراتٍ حرجة) جعلت مطابقةَ المسارات
 * صارمةً افتراضيّاً. فصار `/login` ورابطا الحضور `/a/[token]` و`/c/[token]`
 * **٤٠٤** — والبناءُ ينجح والاختباراتُ خضراء. السبب: `@drawer/[...catchAll]`
 * يمتدّ إلى كلّ عنوان، وموضعُ `children` في `(app)` بلا `default`، فيحكم
 * Next بأنّ المسار ناقصٌ ويحذفه ومعه صفحةُ الدخول. والعلاجُ `(app)/default.tsx`.
 *
 * فيُشغَّل هنا فاحصُ Next نفسُه على شجرة `src/app` الحقيقيّة: من أضاف موضعاً
 * متوازياً أو التقاطاً أو رقّى Next فأسقط صفحةً يعرف قبل أن يعرف الزائر.
 */
const require = createRequire(import.meta.url);
const { normalizeCatchAllRoutes } = require(
  "next/dist/server/lib/router-utils/normalize-catchall-routes.js",
) as {
  normalizeCatchAllRoutes: (
    appPaths: Record<string, string[]>,
    normalizer?: undefined,
    options?: { strictRouteMatching?: boolean; defaultAppPaths?: Iterable<string> },
  ) => { unmatchedAppPages: string[]; incompatibleParallelRouteSlots: unknown[] };
};
const { normalizeAppPath } = require("next/dist/shared/lib/router/utils/app-paths.js") as {
  normalizeAppPath: (route: string) => string;
};

const APP = path.join("src", "app");

/** مساراتُ Next لملفّاتٍ بعينها: `/(app)/suppliers/page` · `/(app)/@drawer/default` */
function appFiles(base: "page" | "default", dir = APP, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) appFiles(base, full, out);
    else if (name === `${base}.tsx` || name === `${base}.ts`) {
      const rel = path.relative(APP, dir).split(path.sep).filter(Boolean).join("/");
      out.push(`/${rel ? `${rel}/` : ""}${base}`);
    }
  }
  return out.sort();
}

function check(defaults: string[]) {
  const perRoute: Record<string, string[]> = {};
  for (const page of appFiles("page")) {
    (perRoute[normalizeAppPath(page)] ??= []).push(page);
  }
  return normalizeCatchAllRoutes(perRoute, undefined, {
    strictRouteMatching: true,
    defaultAppPaths: defaults,
  });
}

describe("كلّ صفحة يبلغها عنوان تحت المطابقة الصارمة", () => {
  const pages = appFiles("page");
  const defaults = appFiles("default");

  it("الفاحص يرى الشجرة فعلاً — صفحاتُ الدخول والحضور واللوح بينها", () => {
    expect(pages).toContain("/login/page");
    expect(pages).toContain("/a/[token]/page");
    expect(pages).toContain("/(app)/@drawer/[...catchAll]/page");
    expect(defaults).toContain("/(app)/default");
  });

  it("لا صفحةَ يحذفها Next، ولا موضعَ متوازياً ناقصاً", () => {
    const { unmatchedAppPages, incompatibleParallelRouteSlots } = check(defaults);
    expect(unmatchedAppPages, "صفحاتٌ يحذفها Next فتصير ٤٠٤").toEqual([]);
    expect(incompatibleParallelRouteSlots).toEqual([]);
  });

  it("وبلا `(app)/default` يسقط الدخولُ ورابطا الحضور — فالحارسُ يعضّ", () => {
    const { unmatchedAppPages } = check(defaults.filter((d) => d !== "/(app)/default"));
    expect(unmatchedAppPages).toEqual(
      expect.arrayContaining(["/login/page", "/a/[token]/page", "/c/[token]/page"]),
    );
  });
});
