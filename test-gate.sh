#!/usr/bin/env bash
# 门禁回归测试：41 组 PASS/FAIL 用例 × node/python 双运行时，82 项断言。
# 覆盖全仓态校验、commit-msg 提交侧校验与 git 钩子端到端（钩子用例在两种
# 门禁实现下各跑一遍——钩子按存在性探测运行时，两路都要咬人）。
# 改 check-docs / hooks 行为后必跑——门禁自己也只认命令输出。
set -u
ASSETS="$(cd "$(dirname "$0")/assets" && pwd)"
T="$(mktemp -d)"
R="$T/repo"
PY=python; command -v python >/dev/null 2>&1 || PY=py
ok=0; bad=0

DECISION_LOG='# 决策记录

## 生效决策

### D-101 引入本治理体系

- **背景**：仓库无任务卡与门禁，跨会话状态靠聊天记忆。
- **决定**：按 repo-governance 脚手架落地任务卡 + 决策记录 + check-docs 门禁。
- **备选**：继续靠会话上下文——腐烂静默且不可逆，弃。
'

scaffold() {
  rm -rf "$R"
  mkdir -p "$R/scripts" "$R/docs/tasks/implemented" "$R/docs/decisions"
  cp "$ASSETS/_template.md" "$R/docs/tasks/_template.md"
  cp "$ASSETS/check-docs.mjs" "$ASSETS/check-docs.py" "$R/scripts/"
  printf '%s' "$DECISION_LOG" > "$R/docs/decisions/decision-log.md"
  printf '# 项目状态\n\n## 进行中\n\n- T-20261014-01 治理自举\n' > "$R/docs/project-status.md"
  printf -- '- **任务 ID**：T-20261014-01\n- **状态**：进行中\n' > "$R/docs/tasks/2026-10-14-bootstrap.md"
  printf -- '- **任务 ID**：T-20260901-01\n- **状态**：完成\n' > "$R/docs/tasks/implemented/2026-09-01-old.md"
  git -C "$R" init -q
  git -C "$R" config user.email t@t && git -C "$R" config user.name t
  git -C "$R" add -A && git -C "$R" commit -qm "chore: 初始脚手架（T-20260901-01 T-20261014-01）"
}

judge() { # label expect rt code
  local label="$1" expect="$2" rt="$3" code="$4" result
  if { [ "$expect" = PASS ] && [ "$code" -eq 0 ]; } || { [ "$expect" = FAIL ] && [ "$code" -ne 0 ]; }; then
    ok=$((ok+1)); result="ok"
  else
    bad=$((bad+1)); result="UNEXPECTED(exit=$code)"
  fi
  printf '%-12s %-30s expect=%-4s %s\n' "$result" "$label" "$expect" "$rt"
}

check() { # label expect(PASS|FAIL) —— 全仓态门禁，双运行时
  local label="$1" expect="$2" rt script code
  for rt in node "$PY"; do
    if [ "$rt" = node ]; then script=scripts/check-docs.mjs; else script=scripts/check-docs.py; fi
    ( cd "$R" && "$rt" "$script" ) >/dev/null 2>&1; code=$?
    judge "$label" "$expect" "$rt" "$code"
  done
}

msgcheck() { # label expect msg文本 —— commit-msg 提交侧模式，双运行时
  local label="$1" expect="$2" msg="$3" rt script code
  printf '%s\n' "$msg" > "$R/.git/msg-test.txt"
  for rt in node "$PY"; do
    if [ "$rt" = node ]; then script=scripts/check-docs.mjs; else script=scripts/check-docs.py; fi
    ( cd "$R" && "$rt" "$script" --commit-msg .git/msg-test.txt ) >/dev/null 2>&1; code=$?
    judge "$label" "$expect" "$rt" "$code"
  done
}

hookcheck() { # label expect 场景函数 —— 真实 git 钩子端到端，两种门禁实现各一遍
  local label="$1" expect="$2" fn="$3" rt code
  for rt in node "$PY"; do
    scaffold
    mkdir -p "$R/scripts/hooks"
    cp "$ASSETS/hooks/pre-commit" "$ASSETS/hooks/commit-msg" "$R/scripts/hooks/"
    if [ "$rt" = node ]; then rm "$R/scripts/check-docs.py"; else rm "$R/scripts/check-docs.mjs"; fi
    git -C "$R" config core.hooksPath scripts/hooks
    "$fn" >/dev/null 2>&1; code=$?
    judge "$label" "$expect" "$rt" "$code"
  done
}

stage_terminal() { # 把自举卡收尾为暂存终态（commit-msg 锚定检查的前置状态）
  git -C "$R" mv docs/tasks/2026-10-14-bootstrap.md docs/tasks/implemented/
  sed -i 's/- \*\*状态\*\*：进行中/- **状态**：完成/' "$R/docs/tasks/implemented/2026-10-14-bootstrap.md"
  git -C "$R" add -A
}

scene_noanchor_commit() { git -C "$R" commit -q --allow-empty -m "chore: 无锚提交"; }

scene_closure_commit() { # 单提交收尾：代码+定稿卡+落目录同笔，钩子全开应通过（D-109 死结回归）
  stage_terminal
  git -C "$R" commit -q -m "feat: 收尾自举任务（T-20261014-01）"
}

scene_merge_commit() { # 合并提交豁免：MERGE_HEAD 在场时无锚信息应放行
  local br; br=$(git -C "$R" symbolic-ref --short HEAD)
  git -C "$R" commit -q --allow-empty -m "chore: 基线（T-20260901-01）"
  git -C "$R" checkout -q -b side
  git -C "$R" commit -q --allow-empty -m "chore: 侧支（T-20260901-01）"
  git -C "$R" checkout -q "$br"
  git -C "$R" merge -q --no-ff --no-commit side
  git -C "$R" commit -q -m "merge: 并入 side（合并豁免）"
}

# —— 全仓态校验 ——
scaffold; check "正常脚手架" PASS

scaffold; printf '遗留：T-20261231-99\n' >> "$R/docs/project-status.md"; check "幽灵登记" FAIL

scaffold; printf -- '- **任务 ID**：T-20261014-02\n- **状态**：草稿\n' > "$R/docs/tasks/2026-10-14-orphan.md"
git -C "$R" add docs/tasks/2026-10-14-orphan.md; check "孤儿卡(已add)" FAIL

scaffold; printf -- '- **任务 ID**：T-20261014-02\n- **状态**：草稿\n' > "$R/docs/tasks/2026-10-14-draft.md"
check "未add草稿卡(降级提醒)" PASS

scaffold; printf -- '- **任务 ID**：T-20260930-09\n- **状态**：完成\n' > "$R/docs/tasks/2026-09-30-stray.md"; check "终态滞留顶层" FAIL

scaffold; printf -- '- **任务 ID**：T-20261014-01\n- **状态**：进行中\n' > "$R/docs/tasks/2026-10-14-dup.md"; check "ID 重复" FAIL

scaffold; rm "$R/docs/project-status.md"; check "状态页缺失" FAIL

scaffold; sed -i 's/<!-- check-docs:[^>]*-->//' "$R/docs/tasks/_template.md"; check "gate 行被删" FAIL

scaffold; printf -- '- **任务 ID**：T-20261014-03\n- **状态**：乱写\n' > "$R/docs/tasks/2026-10-14-bad.md"; printf 'T-20261014-03\n' >> "$R/docs/project-status.md"; check "非法状态" FAIL

scaffold; sed -i 's/implemented/done/' "$R/docs/tasks/_template.md"; mv "$R/docs/tasks/implemented" "$R/docs/tasks/done"; check "目录改名+gate同步" PASS

scaffold; mv "$R/docs/tasks/implemented" "$R/docs/tasks/done"; check "目录改名没同步gate" FAIL

scaffold; printf -- '- **任务 ID**：T-20260901-02\n- **状态**：完成（有保留）\n' > "$R/docs/tasks/implemented/2026-09-01-old2.md"; check "终态状态带后缀(前缀匹配)" PASS

scaffold; rm -rf "$R/.git"; printf -- '- **任务 ID**：T-20261014-02\n- **状态**：草稿\n' > "$R/docs/tasks/2026-10-14-orphan.md"
check "非git仓孤儿卡(fail-closed)" FAIL

# —— 决策四字段 ——
scaffold; sed -i '/- \*\*备选\*\*/d' "$R/docs/decisions/decision-log.md"; check "决策缺备选" FAIL

scaffold; printf '\n## 被否决提案\n\n### D-102 某方案\n\n- **背景**：x。\n- **决定**：否决。\n- **备选**：y。\n' >> "$R/docs/decisions/decision-log.md"
check "否决类缺重开条件" FAIL

scaffold; printf '# 决策记录\n\n## 生效决策\n' > "$R/docs/decisions/decision-log.md"; check "决策零条目" FAIL

scaffold; rm "$R/docs/decisions/decision-log.md"; check "决策记录缺失" FAIL

# —— 入口文档死链 ——
scaffold; printf '\n[死链](docs/不存在.md)\n' >> "$R/docs/project-status.md"; check "状态页死链" FAIL

scaffold; printf '\n[任务卡](tasks/2026-10-14-bootstrap.md)\n' >> "$R/docs/project-status.md"; check "状态页活链" PASS

# —— commit-msg 提交侧校验 ——
scaffold; msgcheck "commit-msg无锚" FAIL "chore: 随手一改"

scaffold; msgcheck "commit-msg编造任务锚" FAIL "fix: 修复（T-20991231-99）"

scaffold; msgcheck "commit-msg编造决策锚" FAIL "docs: 规则修订（D-999）"

scaffold; msgcheck "commit-msg伪锚不误配" FAIL "chore: 配置（XD-101）"

scaffold; msgcheck "commit-msg真实任务锚" PASS "feat: 自举（T-20261014-01）"

scaffold; msgcheck "commit-msg决策锚" PASS "docs: 治理修订（D-101）"

scaffold; msgcheck "commit-msg锚在正文" PASS "chore: 标题无锚

锚在正文 T-20261014-01"

scaffold; stage_terminal; msgcheck "暂存终态卡未锚定" FAIL "feat: 别的事（D-101）"

scaffold; stage_terminal; msgcheck "暂存终态卡被锚定" PASS "feat: 收尾（T-20261014-01）"

# —— 提交快照：暂存区是锚存在性与 gate 配置的证据 ——
scaffold; sed -i 's/D-101/D-01/' "$R/docs/decisions/decision-log.md"
git -C "$R" add docs/decisions/decision-log.md
msgcheck "说明书首条D-01" PASS "docs: 引入治理 D-01"

scaffold; printf -- '- **任务 ID**：T-20261102-99\n- **状态**：草稿\n' > "$R/docs/tasks/new.md"
msgcheck "未跟踪任务不能背书" FAIL "feat: 新任务 T-20261102-99"

scaffold; sed -i 's/T-20261014-01/T-20261102-99/' "$R/docs/tasks/2026-10-14-bootstrap.md"
msgcheck "未暂存任务号不能背书" FAIL "feat: 新编号 T-20261102-99"

scaffold; rm "$R/docs/tasks/2026-10-14-bootstrap.md"
msgcheck "任务按暂存版本取证" PASS "feat: 现有任务 T-20261014-01"

scaffold; printf -- '- **任务 ID**：T-20261102-99\n- **状态**：草稿\n' > "$R/docs/tasks/new.md"
git -C "$R" add docs/tasks/new.md
msgcheck "新任务暂存后可锚定" PASS "feat: 新任务 T-20261102-99"

scaffold; sed -i 's/D-101/D-102/' "$R/docs/decisions/decision-log.md"
msgcheck "未暂存决策不能背书" FAIL "docs: 新决策 D-102"

scaffold; rm "$R/docs/decisions/decision-log.md"
msgcheck "决策按暂存版本取证" PASS "docs: 现有决策 D-101"

scaffold; sed -i 's/D-101/D-102/' "$R/docs/decisions/decision-log.md"
git -C "$R" add docs/decisions/decision-log.md
msgcheck "新决策暂存后可锚定" PASS "docs: 新决策 D-102"

scaffold; sed -i 's/<!-- check-docs:[^>]*-->//' "$R/docs/tasks/_template.md"
msgcheck "gate按暂存版本取证" PASS "feat: 现有任务 T-20261014-01"

scaffold; git -C "$R" rm --cached -q docs/tasks/_template.md
msgcheck "未入暂存的gate不作证" FAIL "feat: 现有任务 T-20261014-01"

# —— git 钩子端到端 ——
hookcheck "钩子拦无锚提交" FAIL scene_noanchor_commit

hookcheck "单提交收尾过钩子" PASS scene_closure_commit

hookcheck "合并提交豁免" PASS scene_merge_commit

rm -rf "$T"
echo "汇总: ok=$ok unexpected=$bad"
[ "$bad" -eq 0 ]
