#!/bin/sh
# يُجدوِل النسخة الاحتياطيّة المحلّيّة كلَّ يوم (launchd على ماك).
#
#   npm run backup:install            ← يثبّت أو يحدّث الجدولة
#   npm run backup:install -- remove  ← يزيلها (لا يمسّ النسخ المحفوظة)
#
# تعمل الساعة ١٣:٠٠ بتوقيت الجهاز. وإن كان الجهاز نائماً عملت حين يصحو.
set -e

LABEL="com.tph.backup"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
ROOT="${BACKUP_ROOT:-$HOME/TPH-Backups}"

if [ "$1" = "remove" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "✓ أُزيلت الجدولة. النسخ في $ROOT باقية."
  exit 0
fi

[ -x "$NODE" ] || { echo "✕ لم يُعثر على node"; exit 1; }
mkdir -p "$ROOT" "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$REPO/node_modules/tsx/dist/cli.mjs</string>
    <string>--env-file=.env</string>
    <string>scripts/backup-local.ts</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(dirname "$NODE"):/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>BACKUP_ROOT</key><string>$ROOT</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>13</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>$ROOT/launchd.log</string>
  <key>StandardErrorPath</key><string>$ROOT/launchd.log</string>
  <key>ProcessType</key><string>Background</string>
  <key>LowPriorityIO</key><true/>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "✓ النسخة الاحتياطيّة مجدولة كلَّ يوم الساعة ١٣:٠٠ — في $ROOT"
echo "  تشغيلٌ الآن للتجربة:  launchctl kickstart gui/$(id -u)/$LABEL"
