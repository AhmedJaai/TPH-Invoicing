#!/bin/bash
# حارسُ git — مأخوذٌ من mattpocock/skills (git-guardrails-claude-code) ومعدَّل:
# الأصلُ يمنع `git push` كلَّه، والمشروعُ يرفع إلى main بعد كلّ تحديثٍ مختبَر
# (فالدفعُ ينشر). فيُمنع هنا ما يمحو عملاً أو يعيد كتابة التاريخ وحده
# (AGENTS.md §12)، ويبقى الدفعُ العاديّ.

INPUT=$(cat)
COMMAND=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty')
[ -z "$COMMAND" ] && exit 0

DANGEROUS_PATTERNS=(
  'git[[:space:]]+push([^|;&]*)[[:space:]](-f|--force|--force-with-lease|--force-if-includes|--mirror|--delete|-d)([[:space:]=]|$)'
  'git[[:space:]]+push([^|;&]*)[[:space:]]\+[^[:space:]]'
  'git[[:space:]]+push([^|;&]*)[[:space:]]:[^[:space:]]'
  'git[[:space:]]+reset([^|;&]*)--hard'
  'git[[:space:]]+clean([^|;&]*)[[:space:]]-[a-zA-Z]*f'
  'git[[:space:]]+branch([^|;&]*)[[:space:]]-D([[:space:]]|$)'
  'git[[:space:]]+checkout([[:space:]]+--)?[[:space:]]+\.([[:space:]]|$)'
  'git[[:space:]]+restore([^|;&]*)[[:space:]]\.([[:space:]]|$)'
  'git[[:space:]]+filter-(branch|repo)'
  'git[[:space:]]+stash[[:space:]]+(clear|drop)'
  'git[[:space:]]+reflog[[:space:]]+expire'
  'git[[:space:]]+update-ref[[:space:]]+-d'
)

for pattern in "${DANGEROUS_PATTERNS[@]}"; do
  if printf '%s' "$COMMAND" | grep -qE "$pattern"; then
    echo "BLOCKED: '$COMMAND' يطابق نمطاً ممنوعاً ($pattern). يمحو عملاً أو يعيد كتابة التاريخ — يفعله أحمد بنفسه إن أراده (AGENTS.md §12)." >&2
    exit 2
  fi
done

exit 0
