#!/usr/bin/env bash
# 门禁回归测试：13 组 PASS/FAIL 用例 × node/python 两运行时。
# 改 check-docs 行为后必跑——门禁自己也只认命令输出。
set -u
ASSETS="$(cd "$(dirname "$0")/assets" && pwd)"
T="$(mktemp -d)"
R="$T/repo"
PY=python; command -v python >/dev/null 2>&1 || PY=py
ok=0; bad=0

scaffold() {
  rm -rf "$R"
  mkdir -p "$R/scripts" "$R/docs/tasks/implemented"
  cp "$ASSETS/_template.md" "$R/docs/tasks/_template.md"
  cp "$ASSETS/check-docs.mjs" "$ASSETS/check-docs.py" "$R/scripts/"
  printf '# 项目状态\n\n## 进行中\n\n- T-20261014-01 治理自举\n' > "$R/docs/project-status.md"
  printf -- '- **任务 ID**：T-20261014-01\n- **状态**：进行中\n' > "$R/docs/tasks/2026-10-14-bootstrap.md"
  printf -- '- **任务 ID**：T-20260901-01\n- **状态**：完成\n' > "$R/docs/tasks/implemented/2026-09-01-old.md"
  git -C "$R" init -q
  git -C "$R" config user.email t@t && git -C "$R" config user.name t
  git -C "$R" add -A && git -C "$R" commit -qm "chore: 初始脚手架（T-20260901-01 T-20261014-01）"
}

check() { # label expect(PASS|FAIL)
  local label="$1" expect="$2" code rt result script
  for rt in node "$PY"; do
    if [ "$rt" = node ]; then script=scripts/check-docs.mjs; else script=scripts/check-docs.py; fi
    ( cd "$R" && "$rt" "$script" ) >/dev/null 2>&1
    code=$?
    if { [ "$expect" = PASS ] && [ "$code" -eq 0 ]; } || { [ "$expect" = FAIL ] && [ "$code" -ne 0 ]; }; then
      ok=$((ok+1)); result="ok"
    else
      bad=$((bad+1)); result="UNEXPECTED(exit=$code)"
    fi
    printf '%-12s %-28s expect=%-4s %s\n' "$result" "$label" "$expect" "$rt"
  done
}

scaffold; check "正常脚手架" PASS

scaffold; printf '遗留：T-20261231-99\n' >> "$R/docs/project-status.md"; check "幽灵登记" FAIL

scaffold; printf -- '- **任务 ID**：T-20261014-02\n- **状态**：草稿\n' > "$R/docs/tasks/2026-10-14-orphan.md"; check "孤儿卡" FAIL

scaffold; printf -- '- **任务 ID**：T-20260930-09\n- **状态**：完成\n' > "$R/docs/tasks/2026-09-30-stray.md"; check "终态滞留顶层" FAIL

scaffold; printf -- '- **任务 ID**：T-20261014-01\n- **状态**：进行中\n' > "$R/docs/tasks/2026-10-14-dup.md"; check "ID 重复" FAIL

scaffold; rm "$R/docs/project-status.md"; check "状态页缺失" FAIL

scaffold; sed -i 's/<!-- check-docs:[^>]*-->//' "$R/docs/tasks/_template.md"; check "gate 行被删" FAIL

scaffold; printf -- '- **任务 ID**：T-20261014-03\n- **状态**：乱写\n' > "$R/docs/tasks/2026-10-14-bad.md"; printf 'T-20261014-03\n' >> "$R/docs/project-status.md"; check "非法状态" FAIL

scaffold; sed -i 's/implemented/done/' "$R/docs/tasks/_template.md"; mv "$R/docs/tasks/implemented" "$R/docs/tasks/done"; check "目录改名+gate同步" PASS

scaffold; mv "$R/docs/tasks/implemented" "$R/docs/tasks/done"; check "目录改名没同步gate" FAIL

scaffold; printf -- '- **任务 ID**：T-20260901-02\n- **状态**：完成（有保留）\n' > "$R/docs/tasks/implemented/2026-09-01-old2.md"; git -C "$R" add -A && git -C "$R" commit -qm "chore: 追加终态卡（T-20260901-02）"; check "终态状态带后缀(前缀匹配)" PASS

scaffold; printf -- '- **任务 ID**：T-20261016-09\n- **状态**：完成\n' > "$R/docs/tasks/implemented/2026-10-16-nocommit.md"; check "幽灵提交号" FAIL

scaffold; rm -rf "$R/.git"; check "非git目录有终态卡" FAIL

rm -rf "$T"
echo "汇总: ok=$ok unexpected=$bad"
[ "$bad" -eq 0 ]
