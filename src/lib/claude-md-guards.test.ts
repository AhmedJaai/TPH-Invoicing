import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * `CLAUDE.md` يُقرأ قبل كلّ مهمّة — فما يسمّيه فيه يجب أن يكون موجوداً.
 *
 * ── العطب الذي أنشأ هذا الملفّ (١ نوفمبر ٢٠٢٦) ──
 *
 * كان يقول «عددٌ واحد للعمل الباقي: `countPendingWork()`»، والدالّةُ حُذفت في
 * ٢١ سبتمبر وحلّ محلَّها `workCount()`. فكلُّ جلسةٍ تُرسَل إلى اسمٍ ميّت ستّةَ
 * أسابيع، ولا شيء يقول ذلك. والإشارةُ التي لا تُطاع أسوأ من غيابها: من يقرؤها
 * يبني عليها.
 */
const doc = readFileSync("CLAUDE.md", "utf8");
const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);

/** ‏`src/lib/money.ts` · `money.ts` — ما بين علامتين وينتهي بامتداد ملفّ. */
const fileRefs = [...new Set([...doc.matchAll(/`([\w./[\]-]+\.(?:ts|tsx|md|json|mjs|css))`/g)].map((m) => m[1]))];
/** ‏`workCount()` — اسمُ دالّةٍ بقوسين. */
const callRefs = [...new Set([...doc.matchAll(/`([a-z][A-Za-z0-9]+)\(\)`/g)].map((m) => m[1]))];

/* دوالُّ SQL أو المكتبات تُذكر في الدليل ولا تُعرَّف عندنا */
const NOT_OURS = new Set(["now"]);

const sources = tracked
  .filter((f) => /^(src|scripts)\/.*\.(ts|tsx|mjs)$/.test(f))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

describe("ما يسمّيه CLAUDE.md موجود", () => {
  it("الحارس يرى الإشارات فعلاً", () => {
    expect(fileRefs.length).toBeGreaterThan(50);
    expect(callRefs).toContain("workCount");
  });

  it("كلُّ ملفٍّ يُذكر متتبَّعٌ في المستودع", () => {
    const missing = fileRefs.filter((ref) =>
      ref.includes("/")
        ? !tracked.some((f) => f === ref || f.endsWith(`/${ref}`))
        : !tracked.some((f) => f.split("/").at(-1) === ref),
    );
    expect(missing, "ملفّاتٌ يذكرها CLAUDE.md ولا وجود لها").toEqual([]);
  });

  it("وكلُّ دالّةٍ تُذكر معرَّفةٌ في src أو scripts", () => {
    const missing = callRefs.filter((name) =>
      !NOT_OURS.has(name) && !new RegExp(`(?:function\\*?|const|let)\\s+${name}\\b`).test(sources));
    expect(missing, "دوالُّ يذكرها CLAUDE.md ولا تعريف لها").toEqual([]);
  });
});
