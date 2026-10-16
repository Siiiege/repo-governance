#!/usr/bin/env node
/**
 * 最小文档门禁（任务卡治理）——零依赖，node scripts/check-docs.mjs 直接跑，非 0 退出码 = FAIL。
 * 唯一权威源：治理模板（默认 docs/tasks/_template.md）的 gate 行（<!-- check-docs:states=...;dirs=... -->）。
 * 校验六件事：
 *  1. gate 行可解析（缺 states/dirs 直接 FAIL——权威源没了要响，不要静默）
 *  2. 任务状态合法性：状态必须是 states 枚举之一的前缀
 *  3. 目录↔状态一致：终态卡必须在 dirs 声明的子目录里，顶层只放活跃卡
 *  4. 孤儿任务：活跃卡必须登记 docs/project-status.md（新会话靠它发现进行中的活）
 *  5. 幽灵登记 / ID 重复：状态页里的任务 ID 必须对应现存卡；卡与卡之间 ID 不重复
 *  6. 幽灵提交号：终态卡的任务 ID 必须能在 git 提交信息里命中——任务↔提交的锚
 *     是提交信息里的任务 ID（卡不记 hash），提交忘带任务号不能静默失联
 * 与 check-docs.py 是同一门禁的两份实现（Node / Python 仓各用其一），改行为两处同步。
 * 调参常量（TEMPLATE_NAME / SKIP_TOP）：与产品文件冲突时按仓改名/加跳过项；改后
 * 本脚本与 skill assets 分叉，回归责任转入库内（自建负例注入测试）。
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TASKS = join(ROOT, 'docs', 'tasks');
const TEMPLATE_NAME = '_template.md'; // 治理模板文件名（与产品模板大小写冲突等情形改这里）
const SKIP_TOP = new Set([TEMPLATE_NAME]); // tasks/ 顶层跳过的非任务卡文件（产品 README 等）
const TEMPLATE = join(TASKS, TEMPLATE_NAME);
const STATUS_PAGE = join(ROOT, 'docs', 'project-status.md');
const STATUS_LINE = /^\s*-\s+\*\*状态\*\*[：:]\s*(\S+)/m;
const ID_LINE = /^\s*-\s+\*\*任务 ID\*\*[：:]\s*(\S+)/m;
const ID_TOKEN = /T-\d{8}-\d+/g; // 幽灵登记 / 幽灵提交号检查的扫描源；改 ID 格式需同步本正则

const problems = [];
const fail = (msg) => problems.push(msg);

if (!existsSync(TASKS) || !existsSync(TEMPLATE)) {
  console.error(`FAIL：docs/tasks/${TEMPLATE_NAME} 不存在——先按治理脚手架落文件`);
  process.exit(1);
}

// 1. gate 行 = 唯一权威源（状态枚举 + 终态目录映射，都在模板的一行里）
const gate = readFileSync(TEMPLATE, 'utf8').match(/<!--\s*check-docs:\s*([^>]*?)\s*-->/);
if (!gate) {
  console.error(`FAIL ${TEMPLATE_NAME}：找不到 gate 行（<!-- check-docs:states=...;dirs=... -->）——权威源缺失`);
  process.exit(1);
}
const params = {};
for (const part of gate[1].split(';')) {
  const eq = part.indexOf('=');
  if (eq > 0) params[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
}
if (!params.states || !params.dirs) {
  console.error(`FAIL ${TEMPLATE_NAME} gate 行：缺 states 或 dirs 段——格式 states=a/b/c;dirs=状态:目录,...`);
  process.exit(1);
}
const STATES = params.states.split('/');
const TERMINAL_DIRS = {}; // 目录 → 状态前缀
for (const pair of params.dirs.split(',')) {
  const colon = pair.indexOf(':');
  if (colon < 1) {
    console.error(`FAIL ${TEMPLATE_NAME} gate 行：dirs 段「${pair}」缺「状态:目录」冒号`);
    process.exit(1);
  }
  TERMINAL_DIRS[pair.slice(colon + 1).trim()] = pair.slice(0, colon).trim();
}

// 2. 状态页必须存在——它是孤儿检查的执行面，缺了门禁形同虚设
if (!existsSync(STATUS_PAGE)) {
  console.error('FAIL：docs/project-status.md 不存在——活跃卡登记无处校验，先补状态页');
  process.exit(1);
}
const statusText = readFileSync(STATUS_PAGE, 'utf8');

let active = 0;
let terminal = 0;
const ids = new Map(); // 任务 ID → 文件位置（查重 + 幽灵登记反查）
const terminalIds = []; // 终态卡 ID——幽灵提交号检查对象

const registerId = (id, where) => {
  if (ids.has(id)) fail(`任务 ID 重复：「${id}」同时出现在 ${ids.get(id)} 与 ${where}`);
  else ids.set(id, where);
};

// 3. 终态子目录：状态前缀与目录一致
for (const [dir, prefix] of Object.entries(TERMINAL_DIRS)) {
  const dirPath = join(TASKS, dir);
  if (!existsSync(dirPath)) continue; // 还没有终态卡时目录可缺
  for (const f of readdirSync(dirPath).sort()) {
    if (!f.endsWith('.md')) continue;
    const text = readFileSync(join(dirPath, f), 'utf8');
    const state = text.match(STATUS_LINE)?.[1];
    if (!state) fail(`tasks/${dir}/${f}：缺少「- **状态**：」行`);
    else if (!state.startsWith(prefix)) fail(`tasks/${dir}/${f}：状态「${state}」应为「${prefix}」开头`);
    else terminal++;
    const id = text.match(ID_LINE)?.[1];
    if (id) {
      registerId(id, `tasks/${dir}/${f}`);
      terminalIds.push(id);
    }
  }
}

// 4. 顶层：只放活跃卡；活跃卡必须登记状态页（防孤儿）
for (const f of readdirSync(TASKS).sort()) {
  const full = join(TASKS, f);
  if (statSync(full).isDirectory()) {
    if (!(f in TERMINAL_DIRS)) fail(`tasks/${f}/：不在 gate 行 dirs 映射里（目录改名必须改 gate 行）`);
    continue;
  }
  if (!f.endsWith('.md') || SKIP_TOP.has(f)) continue;
  const text = readFileSync(full, 'utf8');
  const state = text.match(STATUS_LINE)?.[1];
  if (!state) {
    fail(`tasks/${f}：缺少「- **状态**：」行`);
    continue;
  }
  if (!STATES.some((s) => state.startsWith(s))) {
    fail(`tasks/${f}：状态「${state}」不在 gate 行枚举（${STATES.join('/')}）`);
  }
  const isTerminal = Object.values(TERMINAL_DIRS).some((p) => state.startsWith(p));
  if (isTerminal) {
    fail(`tasks/${f}：终态「${state}」留在顶层，应 git mv 入终态子目录`);
    continue;
  }
  active++;
  const id = text.match(ID_LINE)?.[1];
  if (id) registerId(id, `tasks/${f}`);
  const key = id ?? f;
  if (!statusText.includes(key)) {
    fail(`tasks/${f}：活跃任务未登记 project-status.md（孤儿——新会话无法发现它）`);
  }
}

// 5. 幽灵登记：状态页上的 ID 必须对应现存卡（含终态）——索引反向同样会腐烂
for (const ref of new Set(statusText.match(ID_TOKEN) ?? [])) {
  if (!ids.has(ref)) {
    fail(`project-status.md：登记了「${ref}」但没有对应任务卡（幽灵登记——先修卡或删登记，不要倒填空卡）`);
  }
}

// 6. 幽灵提交号：终态卡的任务 ID 必须在 git 提交信息里命中——卡不记 hash，
//    提交信息里的任务 ID 是任务↔提交的唯一锚，锚断了要响，不要静默
if (terminalIds.length) {
  const git = spawnSync('git', ['log', '--pretty=format:%s'], { encoding: 'utf8' });
  if (git.status !== 0) {
    fail(`git log 不可用（退出码 ${git.status}）——${terminalIds.length} 张终态卡的提交锚无法校验`);
  } else {
    const loggedIds = new Set(git.stdout.match(ID_TOKEN) ?? []);
    for (const id of terminalIds) {
      if (!loggedIds.has(id)) {
        fail(`${ids.get(id)}：git 提交信息中搜不到「${id}」（幽灵提交号——提交信息必须带任务 ID，否则该任务从 git log --grep 检索面静默消失）`);
      }
    }
  }
}

if (problems.length) {
  console.error(`check-docs: FAIL（${problems.length} 处）\n` + problems.map((p) => `  - ${p}`).join('\n'));
  process.exit(1);
}
console.log(`check-docs: PASS（活跃 ${active} / 终态 ${terminal}）`);
