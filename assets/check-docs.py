#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""最小文档门禁（任务卡治理）——零依赖，python3 scripts/check-docs.py 直接跑，非 0 退出码 = FAIL。

唯一权威源：治理模板（默认 docs/tasks/_template.md）的 gate 行（<!-- check-docs:states=...;dirs=... -->）。
校验五件事：
 1. gate 行可解析（缺 states/dirs 直接 FAIL——权威源没了要响，不要静默）
 2. 任务状态合法性：状态必须是 states 枚举之一的前缀
 3. 目录↔状态一致：终态卡必须在 dirs 声明的子目录里，顶层只放活跃卡
 4. 孤儿任务：活跃卡必须登记 docs/project-status.md（新会话靠它发现进行中的活）
 5. 幽灵登记 / ID 重复：状态页里的任务 ID 必须对应现存卡；卡与卡之间 ID 不重复

与 check-docs.mjs 是同一门禁的两份实现（Node / Python 仓各用其一），改行为两处同步。
调参常量（TEMPLATE_NAME / SKIP_TOP）：与产品文件冲突时按仓改名/加跳过项；改后
本脚本与 skill assets 分叉，回归责任转入库内（自建负例注入测试）。
"""
import re
import sys
from pathlib import Path

if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(errors="replace")  # GBK 控制台下中文报错不至于崩

ROOT = Path(__file__).resolve().parent.parent
TASKS = ROOT / "docs" / "tasks"
TEMPLATE_NAME = "_template.md"  # 治理模板文件名（与产品模板大小写冲突等情形改这里）
SKIP_TOP = {TEMPLATE_NAME}  # tasks/ 顶层跳过的非任务卡文件（产品 README 等）
TEMPLATE = TASKS / TEMPLATE_NAME
STATUS_PAGE = ROOT / "docs" / "project-status.md"
STATUS_LINE = re.compile(r"^\s*-\s+\*\*状态\*\*[：:]\s*(\S+)", re.M)
ID_LINE = re.compile(r"^\s*-\s+\*\*任务 ID\*\*[：:]\s*(\S+)", re.M)
GATE_LINE = re.compile(r"<!--\s*check-docs:\s*([^>]*?)\s*-->")
ID_TOKEN = re.compile(r"T-\d{8}-\d+")  # 幽灵登记扫描源；改 ID 格式需同步本正则

problems = []


def fail(msg):
    problems.append(msg)


def die(msg):
    print(msg, file=sys.stderr)
    sys.exit(1)


if not TASKS.is_dir() or not TEMPLATE.is_file():
    die(f"FAIL：docs/tasks/{TEMPLATE_NAME} 不存在——先按治理脚手架落文件")

# 1. gate 行 = 唯一权威源（状态枚举 + 终态目录映射，都在模板的一行里）
gate = GATE_LINE.search(TEMPLATE.read_text(encoding="utf-8"))
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

# 4. 顶层：只放活跃卡；活跃卡必须登记状态页（防孤儿）
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
        fail(f"tasks/{f.name}：活跃任务未登记 project-status.md（孤儿——新会话无法发现它）")

# 5. 幽灵登记：状态页上的 ID 必须对应现存卡（含终态）——索引反向同样会腐烂
for ref in sorted(set(ID_TOKEN.findall(status_text))):
    if ref not in ids:
        fail(f"project-status.md：登记了「{ref}」但没有对应任务卡（幽灵登记——先修卡或删登记，不要倒填空卡）")

if problems:
    print(f"check-docs: FAIL（{len(problems)} 处）", file=sys.stderr)
    for p in problems:
        print(f"  - {p}", file=sys.stderr)
    sys.exit(1)
print(f"check-docs: PASS（活跃 {active} / 终态 {terminal}）")
