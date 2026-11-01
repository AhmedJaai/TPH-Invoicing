# مهاراتُ الوكيل في هذا المشروع

مهاراتٌ من خارج المستودع، قُرئ كلُّ ملفٍّ فيها قبل وضعه هنا (١ نوفمبر ٢٠٢٦)، ومثبَّتةٌ على نسخةٍ بعينها.
**وحين تخالف إحداها `AGENTS.md` أو `CLAUDE.md` فالمستودعُ يغلب** — هي مراجعُ لا أوامر.
وتحديثُها يدويّ: تُقرأ النسخةُ الجديدة قبل نسخها، ولا تُثبَّت مهارةٌ بلا قراءة (ولا بـ`-g -y`).

| المهارة | المصدر @ النسخة | ما غُيِّر هنا |
|---|---|---|
| `neon-postgres-egress-optimizer` | neondatabase/agent-skills @ `d3da7cb` (Apache-2.0) | حُذف سطرُ جلبِ مهارةٍ أمّ من الشبكة |
| `supabase-postgres-best-practices` | supabase/agent-skills @ `c9be0e9` (MIT) | — |
| `react-best-practices` | vercel-labs/agent-skills @ `1a2c79d` (MIT) | — |
| `web-design-guidelines` | vercel-labs/agent-skills @ `1a2c79d` + web-interface-guidelines @ `434b7f9` (MIT) | القواعدُ نسخةٌ محلّية (`guidelines.md`) لا تُجلب، وأُضيفت أعرافُ المشروع (عربيّ RTL · `arabic.ts` · `ui.tsx`) |
| `next-bundle-optimizer` | vercel/next.js `skills/` @ `3bccd4d` (MIT) | لا يثبّت مهاراتٍ أخرى بنفسه |
| `systematic-debugging` · `verification-before-completion` | obra/superpowers @ `2ce8aa1` (MIT) | — |
| `tdd` · `improve-codebase-architecture` · `codebase-design` · `domain-modeling` · `writing-for-agents` | mattpocock/skills @ `4ae2317` (MIT) | لا «grilling» (بطلب أحمد)، والقراراتُ في `docs/decisions/` لا `docs/adr/` |
| `find-skills` | vercel-labs/skills @ `92a9a34` (MIT) | يبحث ويعرض ولا يثبّت |

**وحارسُ git** (`.claude/hooks/block-dangerous-git.sh`) من mattpocock/skills `git-guardrails-claude-code`، معدَّلاً:
يمنع الدفعَ القسريّ والحذفَ من البعيد و`reset --hard` و`clean -f` و`branch -D` و`checkout .`/`restore .`
وإعادةَ كتابة التاريخ — ويسمح بـ`git push origin main` لأنّ الرفعَ بعد الفحص عُرفُ المشروع.

**والإضافاتُ** (`.claude/settings.json` → `enabledPlugins`) تُثبَّت من متجرها عند أوّل جلسةٍ بعدها:
من Anthropic `security-guidance` · `typescript-lsp` (يحتاج `typescript-language-server` على الجهاز) · `context7` · `claude-md-management`؛
ومن Trail of Bits `dimensional-analysis` · `property-based-testing` · `supply-chain-risk-auditor` (يحتاج `uv`) · `insecure-defaults` · `sharp-edges`.
تلك إضافاتٌ لا مهاراتٌ منسوخة لأنّها تحمل وكلاءها وخطواتِ عملها معها.
