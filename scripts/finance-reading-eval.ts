/**
 * تقييمُ القراءة الذكيّة على شهرٍ حقيقيّ — يطبع الحقائقَ المعطاة للنموذج، ثمّ كلَّ جملةٍ
 * كتبها وأُبقيت (✔) أم أُسقطت (✕) والأرقامَ التي قُرئت فيها. قراءةٌ من القاعدة ونداءٌ واحد
 * لـDeepSeek؛ لا يُحفَظ شيء.
 *
 *   npm run finance:reading-eval -- 2026-09
 *
 * يُقيَّم به صدقُ القراءة قبل تعديل ما يُعطاه النموذج: أهي عن هذا المقهى أم كلامٌ عامّ؟
 */
import { callDeepseek, parseJsonLoose } from "@/lib/ai/deepseek";
import { buildReadingMessages, validateReading, numbersIn } from "@/lib/finance/reading";
import { gatherFactsForDebug } from "@/services/finance-reading.service";
import { formatMonth } from "@/lib/riyadh-time";
(async () => {
  const month = process.argv[2] ?? "2026-09";
  const facts = await gatherFactsForDebug(month);
  const { system, user } = buildReadingMessages(formatMonth(month), facts);
  console.log(user);
  const r = await callDeepseek({ task: "REASONING", messages: [{ role: "system", content: system }, { role: "user", content: user }], json: true, maxTokens: 2500, thinking: false, timeoutMs: 60000 });
  if (!r.ok) { console.log("FAIL", r.reason); process.exit(1); }
  const j = parseJsonLoose(r.text);
  if (!j.ok) { console.log("not json", r.text.slice(0, 500)); process.exit(1); }
  const raw = (j.value as { sentences: { section: string; text: string; facts: string[] }[] }).sentences;
  const v = validateReading(j.value, facts);
  console.log("\n— model:", r.model, "cost$", r.estimatedCostUsd.toFixed(4), "ms", r.durationMs, "kept", v.sentences.length, "dropped", v.dropped);
  for (const s of raw) console.log(`${v.sentences.some((k) => k.text === s.text.trim()) ? "✔" : "✕"} [${s.section}] ${s.text}  {${(s.facts ?? []).join(",")}} nums=${numbersIn(s.text).join("|")}`);
  process.exit(0);
})();
