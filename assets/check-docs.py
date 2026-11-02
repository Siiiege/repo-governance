#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""最小文档门禁（任务卡治理）——零依赖，python3 scripts/check-docs.py 直接跑，非 0 退出码 = FAIL。

唯一权威源：治理模板（默认 docs/tasks/_template.md）的 gate 行（<!-- check-docs:states=...;dirs=... -->）。
两种模式，职责分离（混跑会把未入本笔提交的工作区状态当校验输入，误伤）：

全仓态（无参；总门禁 / pre-commit 快检）：
 1. gate 行可解析（缺 states/dirs 直接 FAIL——权威源没了要响，不要静默）
 2. 任务状态合法性：状态必须是 states 枚举之一的前缀
 3. 目录↔状态一致：终态卡必须在 dirs 声明的子目录里，顶层只放活跃卡
 4. 孤儿任务：活跃卡必须登记 docs/project-status.md；只问责已进 git index 的卡
    （未 add 的草稿降级提醒——登记义务的期限是 add/共享时刻，草稿期空档是
    并行会话的合法中间态；git 不可用时 fail-closed，全视为已入库）
 5. 幽灵登记 / ID 重复：状态页里的任务 ID 必须对应现存卡；卡与卡之间 ID 不重复
 6. 决策四字段：decision-log 每个 D-NNN 条目必须有背景/决定/备选，被否决类
    条目（所在节名以「被否决」开头）还须重开条件——没有重开条件的否决案，
    要么永久绑架要么被无据翻案
 7. 入口文档死链：ENTRY_DOCS 清单里存在的文档，其相对 markdown 链接必须指向
    真实文件——脚手架铺的文档网，最先腐烂的形态就是断链

提交侧（--commit-msg <file>，由 commit-msg 钩子调用）：
 8. 每笔提交信息必须带任务 ID（T-…）或决策锚（D-NNN），且锚在本笔暂存快照中存在——
    任务↔提交的唯一锚在提交信息里，忘带即从 git log --grep 检索面静默消失
 9. 暂存终态卡必须被本笔信息锚定——卡随本笔入库，锚也必须在场；这是
    单提交收尾（代码 + 定稿卡同笔）在门禁上成立的依据

提交锚只在提交那一刻校验（消息文件与暂存快照可见，gate / 任务卡 / 决策均从 index 读取）；全仓态不做 git log 反查——
本笔提交未出生、log 永远滞后一笔，自引用死结会把单提交收尾机制性堵死（来源仓
实测：定案当日 6 任务被迫两段式收尾，后改提交侧校验修正）。合并提交豁免在
钩子里（scripts/hooks/commit-msg 的 MERGE_HEAD 检查）。
与 check-docs.mjs 是同一门禁的两份实现（Node / Python 仓各用其一），改行为两处同步。
调参常量（TEMPLATE_NAME / SKIP_TOP / ID_TOKEN / DECISION_TOKEN / ENTRY_DOCS）：
与产品文件冲突时按仓改名/加跳过项/调清单；改后本脚本与 skill assets 分叉，
回归责任转入库内（自建负例注入测试）。
"""
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote

if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(errors="replace")  # GBK 控制台下中文报错不至于崩

ROOT = Path(__file__).resolve().parent.parent
TASKS = ROOT / "docs" / "tasks"
TASKS_REL = "docs/tasks"  # git ls-files / git diff 输出的仓库相对路径前缀
TEMPLATE_NAME = "_template.md"  # 治理模板文件名（与产品模板大小写冲突等情形改这里）
SKIP_TOP = {TEMPLATE_NAME}  # tasks/ 顶层跳过的非任务卡文件（产品 README 等）
TEMPLATE = TASKS / TEMPLATE_NAME
STATUS_PAGE = ROOT / "docs" / "project-status.md"
DECISION_LOG = ROOT / "docs" / "decisions" / "decision-log.md"
ENTRY_DOCS = [  # 死链检查的入口清单；被仓库形状裁剪掉的文件跳过不查
    "AGENTS.md",
    "docs/README.md",
    "docs/project-context.md",
    "docs/project-status.md",
    "docs/decisions/decision-log.md",
    "docs/architecture/source-map.md",
    "docs/workflow/development.md",
    "docs/workflow/branch-workflow.md",
]
STATUS_LINE = re.compile(r"^\s*-\s+\*\*状态\*\*[：:]\s*(\S+)", re.M)
ID_LINE = re.compile(r"^\s*-\s+\*\*任务 ID\*\*[：:]\s*(\S+)", re.M)
FIELD_LINE = re.compile(r"\s*-\s+\*\*([^*：:]+)\*\*")  # 决策条目的「- **字段**：」行
ID_TOKEN = re.compile(r"(?<![A-Za-z])T-\d{8}-\d+")  # 任务锚扫描源；改 ID 格式需同步本正则
DECISION_TOKEN = re.compile(r"(?<![A-Za-z])D-\d{2,}")  # 决策锚扫描源（decision-log 条目号，至少两位）
REQUIRED_FIELDS = ["背景", "决定", "备选"]

problems = []


def fail(msg):
    problems.append(msg)


def die(msg):
    print(msg, file=sys.stderr)
    sys.exit(1)


def git(args):
    """跑 git；返回 (returncode, stdout)。git 不可用时 returncode 为 None。"""
    try:
        proc = subprocess.run(
            ["git", *args], capture_output=True, cwd=ROOT, encoding="utf-8", errors="replace"
        )
        return proc.returncode, proc.stdout
    except OSError:
        return None, ""


def read_index(path):
    code, blob = git(["show", f":{path}"])
    if code != 0:
        die(f"FAIL：无法读取暂存区 {path}——提交锚只认本笔提交快照")
    return blob


commit_mode = "--commit-msg" in sys.argv
if not commit_mode and (not TASKS.is_dir() or not TEMPLATE.is_file()):
    die(f"FAIL：docs/tasks/{TEMPLATE_NAME} 不存在——先按治理脚手架落文件")
template_text = read_index(f"{TASKS_REL}/{TEMPLATE_NAME}") if commit_mode else TEMPLATE.read_text(encoding="utf-8")

# 1. gate 行 = 唯一权威源（状态枚举 + 终态目录映射，都在模板的一行里）
gate = re.search(r"<!--\s*check-docs:\s*([^>]*?)\s*-->", template_text)
if not gate:
    die(f"FAIL {TEMPLATE_NAME}：找不到 gate 行（<!-- check-docs:states=...;dirs=... -->）——权威源缺失")
params = {}
for part in gate.group(1).split(";"):
    key, eq, value = part.partition("=")
    if eq:
        params[key.strip()] = value.strip()
if not params.get("states") or not params.get("dirs"):
    die(f"FAIL {TEMPLATE_NAME} gate 行：缺 states 或 dirs 段——格式 states=a/b/c;dirs=状态:目录,...")
STATES = params["states"].split("/")
TERMINAL_DIRS = {}  # 目录 → 状态前缀
for pair in params["dirs"].split(","):
    prefix, colon, dir_name = pair.partition(":")
    if not colon or not prefix.strip() or not dir_name.strip():
        die(f"FAIL {TEMPLATE_NAME} gate 行：dirs 段「{pair}」缺「状态:目录」冒号")
    TERMINAL_DIRS[dir_name.strip()] = prefix.strip()

if "--commit-msg" in sys.argv:
    # ---- 提交侧模式：只校验本笔提交的锚（git 写入的消息文件含 # 注释帮助行，
    #      提交时 git 会剥掉——校验前同样剥掉）----
    msg_idx = sys.argv.index("--commit-msg")
    msg_path = sys.argv[msg_idx + 1] if len(sys.argv) > msg_idx + 1 else None
    if not msg_path or not Path(msg_path).is_file():
        die(f"FAIL：--commit-msg 需要存在的消息文件路径参数（收到：{msg_path or '无'}）")
    msg = "\n".join(l for l in Path(msg_path).read_text(encoding="utf-8").splitlines() if not l.startswith("#"))
    task_anchors = sorted(set(ID_TOKEN.findall(msg)))
    decision_anchors = sorted(set(DECISION_TOKEN.findall(msg)))

    # 8. 每笔提交必须带锚，且锚真实存在
    if not task_anchors and not decision_anchors:
        fail("提交信息未携带任务 ID（T-…）或决策锚（D-NNN）——忘带即从 git log --grep 检索面静默消失")
    code, listed = git(["ls-files", "-z", "--", TASKS_REL])
    if code != 0:
        die("FAIL：git ls-files 不可用——提交锚无法从暂存区取证")
    index_task_ids = set()
    for path in filter(None, listed.split("\0")):
        parts = path[len(TASKS_REL) + 1:].split("/")
        if not path.endswith(".md") or parts[-1] in SKIP_TOP:
            continue
        if not (len(parts) == 1 or (len(parts) == 2 and parts[0] in TERMINAL_DIRS)):
            continue
        id_m = ID_LINE.search(read_index(path))
        if id_m:
            index_task_ids.add(id_m.group(1))
    for t in task_anchors:
        if t not in index_task_ids:
            fail(f"任务锚「{t}」在暂存区 docs/tasks/ 中不存在（任务卡须随提交入库）")
    if decision_anchors:
        log = read_index("docs/decisions/decision-log.md")
        index_decision_ids = set(re.findall(r"^###\s+(D-\d+)", log, re.M))
        for d in decision_anchors:
            if d not in index_decision_ids:
                fail(f"决策锚「{d}」在暂存区 decision-log 中不存在")

    # 9. 暂存终态卡必须被本笔信息锚定
    code, out = git(
        [
            "diff",
            "--cached",
            "--name-only",
            "-z",
            "--diff-filter=ACMR",
            "--",
            *[f"{TASKS_REL}/{d}" for d in TERMINAL_DIRS],
        ]
    )
    if code != 0:
        fail("git diff --cached 不可用——暂存终态卡的锚定无法校验")
    else:
        for p in [l for l in out.split("\0") if l]:
            id_m = ID_LINE.search(read_index(p))
            card_id = id_m.group(1) if id_m else None
            if card_id and card_id not in task_anchors:
                fail(f"暂存终态卡「{card_id}」未出现在本笔提交信息中（终态卡必须被所在提交锚定——单提交收尾的成立依据）")

    if problems:
        print(f"check-docs: FAIL（{len(problems)} 处）", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        sys.exit(1)
    print(
        f"check-docs: PASS（提交锚：任务 {' / '.join(task_anchors) or '无'} / 决策 "
        f"{' / '.join(decision_anchors) or '无'}，暂存终态卡锚定齐全）"
    )
    sys.exit(0)

# ---- 全仓态模式 ----

# 2. 状态页必须存在——它是孤儿检查的执行面，缺了门禁形同虚设
if not STATUS_PAGE.is_file():
    die("FAIL：docs/project-status.md 不存在——活跃卡登记无处校验，先补状态页")
status_text = STATUS_PAGE.read_text(encoding="utf-8")

active = 0
terminal = 0
ids = {}  # 任务 ID → 文件位置（查重 + 幽灵登记反查）


def register_id(task_id, where):
    if task_id in ids:
        fail(f"任务 ID 重复：「{task_id}」同时出现在 {ids[task_id]} 与 {where}")
    else:
        ids[task_id] = where


# 3. 终态子目录：状态前缀与目录一致
for dir_name, prefix in TERMINAL_DIRS.items():
    dir_path = TASKS / dir_name
    if not dir_path.is_dir():
        continue  # 还没有终态卡时目录可缺
    for f in sorted(dir_path.glob("*.md")):
        text = f.read_text(encoding="utf-8")
        state_m = STATUS_LINE.search(text)
        if not state_m:
            fail(f"tasks/{dir_name}/{f.name}：缺少「- **状态**：」行")
        else:
            state = state_m.group(1)
            if not state.startswith(prefix):
                fail(f"tasks/{dir_name}/{f.name}：状态「{state}」应为「{prefix}」开头")
            else:
                terminal += 1
        id_m = ID_LINE.search(text)
        if id_m:
            register_id(id_m.group(1), f"tasks/{dir_name}/{f.name}")

# 孤儿问责范围 = git index（已 add/提交）；git 不可用时 fail-closed 全视为已入库
ls_code, ls_out = git(["ls-files", "--", TASKS_REL])
tracked_cards = {l for l in ls_out.splitlines() if l} if ls_code == 0 else None

# 4. 顶层：只放活跃卡；活跃卡必须登记状态页（防孤儿，D-111 同型收窄）
for entry in sorted(TASKS.iterdir()):
    if entry.is_dir():
        if entry.name not in TERMINAL_DIRS:
            fail(f"tasks/{entry.name}/：不在 gate 行 dirs 映射里（目录改名必须改 gate 行）")
        continue
    if entry.suffix != ".md" or entry.name in SKIP_TOP:
        continue
    f = entry
    text = f.read_text(encoding="utf-8")
    state_m = STATUS_LINE.search(text)
    if not state_m:
        fail(f"tasks/{f.name}：缺少「- **状态**：」行")
        continue
    state = state_m.group(1)
    if not any(state.startswith(s) for s in STATES):
        fail(f"tasks/{f.name}：状态「{state}」不在 gate 行枚举（{'/'.join(STATES)}）")
    if any(state.startswith(p) for p in TERMINAL_DIRS.values()):
        fail(f"tasks/{f.name}：终态「{state}」留在顶层，应 git mv 入终态子目录")
        continue
    active += 1
    id_m = ID_LINE.search(text)
    key = id_m.group(1) if id_m else f.name
    if id_m:
        register_id(key, f"tasks/{f.name}")
    if key not in status_text:
        tracked = tracked_cards is None or f"{TASKS_REL}/{f.name}" in tracked_cards
        if tracked:
            fail(f"tasks/{f.name}：活跃任务未登记 project-status.md（孤儿——新会话无法发现它）")
        else:
            print(f"check-docs: 提醒 tasks/{f.name} 未登记 project-status.md（未 add 草稿，add/提交前须登记）")

# 5. 幽灵登记：状态页上的 ID 必须对应现存卡（含终态）——索引反向同样会腐烂
for ref in sorted(set(ID_TOKEN.findall(status_text))):
    if ref not in ids:
        fail(f"project-status.md：登记了「{ref}」但没有对应任务卡（幽灵登记——先修卡或删登记，不要倒填空卡）")

# 6. 决策条目四字段完整性
decision_count = 0
if not DECISION_LOG.is_file():
    fail("docs/decisions/decision-log.md 不存在——脚手架文件不齐，四字段无处校验")
else:
    log_text = DECISION_LOG.read_text(encoding="utf-8")
    section = ""
    entry_id = None
    entries = {}
    for line in log_text.splitlines():
        if line.startswith("## "):
            section = line[3:].strip()
        elif re.match(r"^###\s+D-\d+", line):
            entry_id = re.match(r"^###\s+(D-\d+)", line).group(1)
            entries[entry_id] = {"section": section, "fields": set()}
        elif entry_id:
            field_m = FIELD_LINE.match(line)
            if field_m:
                entries[entry_id]["fields"].add(field_m.group(1).strip())
    if not entries:
        fail("decision-log：未解析到任何「### D-NNN」条目——首条决策（如「引入本治理体系」）应随脚手架落地")
    for eid, meta in entries.items():
        decision_count += 1
        for req in REQUIRED_FIELDS:
            if req not in meta["fields"]:
                fail(f"decision-log {eid}：缺少「**{req}**」字段")
        if meta["section"].startswith("被否决") and "重开条件" not in meta["fields"]:
            fail(f"decision-log {eid}：被否决类条目缺少「**重开条件**」")

# 7. 入口文档死链
for doc in ENTRY_DOCS:
    full = ROOT / doc
    if not full.is_file():
        continue  # 被仓库形状裁剪的入口文件不查
    text = full.read_text(encoding="utf-8")
    for link in re.findall(r"\]\(([^)\s]+)\)", text):
        if re.match(r"^(https?:|mailto:|#)", link):
            continue
        path = link.split("#")[0]
        if not path:
            continue
        try:
            target = unquote(path)
        except Exception:
            target = path
        if not full.parent.joinpath(target).exists():
            fail(f"{doc}：死链 {link}")

if problems:
    print(f"check-docs: FAIL（{len(problems)} 处）", file=sys.stderr)
    for p in problems:
        print(f"  - {p}", file=sys.stderr)
    sys.exit(1)
print(f"check-docs: PASS（活跃 {active} / 终态 {terminal} / 决策 {decision_count} 条，入口文档无死链）")
