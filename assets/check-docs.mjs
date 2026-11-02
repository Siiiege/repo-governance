#!/usr/bin/env node
/**
 * 最小文档门禁（任务卡治理）——零依赖，node scripts/check-docs.mjs 直接跑，非 0 退出码 = FAIL。
 * 唯一权威源：治理模板（默认 docs/tasks/_template.md）的 gate 行（<!-- check-docs:states=...;dirs=... -->）。
 * 两种模式，职责分离（混跑会把未入本笔提交的工作区状态当校验输入，误伤）：
 *
 * 全仓态（无参；总门禁 / pre-commit 快检）：
 *  1. gate 行可解析（缺 states/dirs 直接 FAIL——权威源没了要响，不要静默）
 *  2. 任务状态合法性：状态必须是 states 枚举之一的前缀
 *  3. 目录↔状态一致：终态卡必须在 dirs 声明的子目录里，顶层只放活跃卡
 *  4. 孤儿任务：活跃卡必须登记 docs/project-status.md；只问责已进 git index 的卡
 *     （未 add 的草稿降级提醒——登记义务的期限是 add/共享时刻，草稿期空档是
 *     并行会话的合法中间态；git 不可用时 fail-closed，全视为已入库）
 *  5. 幽灵登记 / ID 重复：状态页里的任务 ID 必须对应现存卡；卡与卡之间 ID 不重复
 *  6. 决策四字段：decision-log 每个 D-NNN 条目必须有背景/决定/备选，被否决类
 *     条目（所在节名以「被否决」开头）还须重开条件——没有重开条件的否决案，
 *     要么永久绑架要么被无据翻案
 *  7. 入口文档死链：ENTRY_DOCS 清单里存在的文档，其相对 markdown 链接必须指向
 *     真实文件——脚手架铺的文档网，最先腐烂的形态就是断链
 *
 * 提交侧（--commit-msg <file>，由 commit-msg 钩子调用）：
 *  8. 每笔提交信息必须带任务 ID（T-…）或决策锚（D-NNN），且锚在本笔暂存快照中存在——
 *     任务↔提交的唯一锚在提交信息里，忘带即从 git log --grep 检索面静默消失
 *  9. 暂存终态卡必须被本笔信息锚定——卡随本笔入库，锚也必须在场；这是
 *     单提交收尾（代码 + 定稿卡同笔）在门禁上成立的依据
 *
 * 提交锚只在提交那一刻校验（消息文件与暂存快照可见，gate / 任务卡 / 决策均从 index 读取）；全仓态不做 git log 反查——
 * 本笔提交未出生、log 永远滞后一笔，自引用死结会把单提交收尾机制性堵死（来源仓
 * 实测：定案当日 6 任务被迫两段式收尾，后改提交侧校验修正）。合并提交豁免在
 * 钩子里（scripts/hooks/commit-msg 的 MERGE_HEAD 检查）。
 * 与 check-docs.py 是同一门禁的两份实现（Node / Python 仓各用其一），改行为两处同步。
 * 调参常量（TEMPLATE_NAME / SKIP_TOP / ID_TOKEN / DECISION_TOKEN / ENTRY_DOCS）：
 * 与产品文件冲突时按仓改名/加跳过项/调清单；改后本脚本与 skill assets 分叉，
 * 回归责任转入库内（自建负例注入测试）。
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TASKS = join(ROOT, 'docs', 'tasks');
const TASKS_REL = 'docs/tasks'; // git ls-files / git diff 输出的仓库相对路径前缀
const TEMPLATE_NAME = '_template.md'; // 治理模板文件名（与产品模板大小写冲突等情形改这里）
const SKIP_TOP = new Set([TEMPLATE_NAME]); // tasks/ 顶层跳过的非任务卡文件（产品 README 等）
const TEMPLATE = join(TASKS, TEMPLATE_NAME);
const STATUS_PAGE = join(ROOT, 'docs', 'project-status.md');
const DECISION_LOG = join(ROOT, 'docs', 'decisions', 'decision-log.md');
const ENTRY_DOCS = [ // 死链检查的入口清单；被仓库形状裁剪掉的文件跳过不查
  'AGENTS.md',
  'docs/README.md',
  'docs/project-context.md',
  'docs/project-status.md',
  'docs/decisions/decision-log.md',
  'docs/architecture/source-map.md',
  'docs/workflow/development.md',
  'docs/workflow/branch-workflow.md',
];
const STATUS_LINE = /^\s*-\s+\*\*状态\*\*[：:]\s*(\S+)/m;
const ID_LINE = /^\s*-\s+\*\*任务 ID\*\*[：:]\s*(\S+)/m;
const FIELD_LINE = /^\s*-\s+\*\*([^*：:]+)\*\*/; // 决策条目的「- **字段**：」行
const ID_TOKEN = /(?<![A-Za-z])T-\d{8}-\d+/g; // 任务锚扫描源；改 ID 格式需同步本正则
const DECISION_TOKEN = /(?<![A-Za-z])D-\d{2,}/g; // 决策锚扫描源（decision-log 条目号，至少两位）
const REQUIRED_FIELDS = ['背景', '决定', '备选'];

const problems = [];
const fail = (msg) => problems.push(msg);
const die = (msg) => {
  console.error(msg);
  process.exit(1);
};

const msgIdx = process.argv.indexOf('--commit-msg');
function readIndex(path) {
  const blob = spawnSync('git', ['show', `:${path}`], { cwd: ROOT, encoding: 'utf8' });
  if (blob.status !== 0) die(`FAIL：无法读取暂存区 ${path}——提交锚只认本笔提交快照`);
  return blob.stdout;
}
if (msgIdx === -1 && (!existsSync(TASKS) || !existsSync(TEMPLATE))) {
  die(`FAIL：docs/tasks/${TEMPLATE_NAME} 不存在——先按治理脚手架落文件`);
}
const templateText = msgIdx === -1
  ? readFileSync(TEMPLATE, 'utf8')
  : readIndex(`${TASKS_REL}/${TEMPLATE_NAME}`);

// 1. gate 行 = 唯一权威源（状态枚举 + 终态目录映射，都在模板的一行里）
const gate = templateText.match(/<!--\s*check-docs:\s*([^>]*?)\s*-->/);
if (!gate) {
  die(`FAIL ${TEMPLATE_NAME}：找不到 gate 行（<!-- check-docs:states=...;dirs=... -->）——权威源缺失`);
}
const params = {};
for (const part of gate[1].split(';')) {
  const eq = part.indexOf('=');
  if (eq > 0) params[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
}
if (!params.states || !params.dirs) {
  die(`FAIL ${TEMPLATE_NAME} gate 行：缺 states 或 dirs 段——格式 states=a/b/c;dirs=状态:目录,...`);
}
const STATES = params.states.split('/');
const TERMINAL_DIRS = {}; // 目录 → 状态前缀
for (const pair of params.dirs.split(',')) {
  const colon = pair.indexOf(':');
  if (colon < 1) {
    die(`FAIL ${TEMPLATE_NAME} gate 行：dirs 段「${pair}」缺「状态:目录」冒号`);
  }
  TERMINAL_DIRS[pair.slice(colon + 1).trim()] = pair.slice(0, colon).trim();
}

if (msgIdx !== -1) {
  // ---- 提交侧模式：只校验本笔提交的锚（git 写入的消息文件含 # 注释帮助行，
  //      提交时 git 会剥掉——校验前同样剥掉）----
  const msgFile = process.argv[msgIdx + 1];
  if (!msgFile || !existsSync(msgFile)) {
    die(`FAIL：--commit-msg 需要存在的消息文件路径参数（收到：${msgFile ?? '无'}）`);
  }
  const msg = readFileSync(msgFile, 'utf8')
    .split(/\r?\n/)
    .filter((l) => !l.startsWith('#'))
    .join('\n');
  const taskAnchors = [...new Set(msg.match(ID_TOKEN) ?? [])];
  const decisionAnchors = [...new Set(msg.match(DECISION_TOKEN) ?? [])];

  // 8. 每笔提交必须带锚，且锚真实存在
  if (taskAnchors.length + decisionAnchors.length === 0) {
    fail('提交信息未携带任务 ID（T-…）或决策锚（D-NNN）——忘带即从 git log --grep 检索面静默消失');
  }
  const listed = spawnSync('git', ['ls-files', '-z', '--', TASKS_REL], { cwd: ROOT, encoding: 'utf8' });
  if (listed.status !== 0) die('FAIL：git ls-files 不可用——提交锚无法从暂存区取证');
  const indexTaskIds = new Set();
  for (const path of listed.stdout.split('\0').filter(Boolean)) {
    const parts = path.slice(TASKS_REL.length + 1).split('/');
    if (!path.endsWith('.md') || SKIP_TOP.has(parts.at(-1))) continue;
    if (!(parts.length === 1 || (parts.length === 2 && parts[0] in TERMINAL_DIRS))) continue;
    const id = readIndex(path).match(ID_LINE)?.[1];
    if (id) indexTaskIds.add(id);
  }
  for (const t of taskAnchors) {
    if (!indexTaskIds.has(t)) fail(`任务锚「${t}」在暂存区 docs/tasks/ 中不存在（任务卡须随提交入库）`);
  }
  if (decisionAnchors.length) {
    const log = readIndex('docs/decisions/decision-log.md');
    const indexDecisionIds = new Set([...log.matchAll(/^###\s+(D-\d+)/gm)].map((m) => m[1]));
    for (const d of decisionAnchors) {
      if (!indexDecisionIds.has(d)) fail(`决策锚「${d}」在暂存区 decision-log 中不存在`);
    }
  }

  // 9. 暂存终态卡必须被本笔信息锚定
  const staged = spawnSync(
    'git',
    [
      'diff',
      '--cached',
      '--name-only',
      '-z',
      '--diff-filter=ACMR',
      '--',
      ...Object.keys(TERMINAL_DIRS).map((d) => `${TASKS_REL}/${d}`),
    ],
    { cwd: ROOT, encoding: 'utf8' }
  );
  if (staged.status !== 0) {
    fail('git diff --cached 不可用——暂存终态卡的锚定无法校验');
  } else {
    for (const p of staged.stdout.split('\0').filter(Boolean)) {
      const cardId = readIndex(p).match(ID_LINE)?.[1];
      if (cardId && !taskAnchors.includes(cardId)) {
        fail(
          `暂存终态卡「${cardId}」未出现在本笔提交信息中（终态卡必须被所在提交锚定——单提交收尾的成立依据）`
        );
      }
    }
  }

  if (problems.length) {
    console.error(`check-docs: FAIL（${problems.length} 处）\n` + problems.map((p) => `  - ${p}`).join('\n'));
    process.exit(1);
  }
  console.log(
    `check-docs: PASS（提交锚：任务 ${taskAnchors.join(' / ') || '无'} / 决策 ${
      decisionAnchors.join(' / ') || '无'
    }，暂存终态卡锚定齐全）`
  );
  process.exit(0);
}

// ---- 全仓态模式 ----

// 2. 状态页必须存在——它是孤儿检查的执行面，缺了门禁形同虚设
if (!existsSync(STATUS_PAGE)) {
  die('FAIL：docs/project-status.md 不存在——活跃卡登记无处校验，先补状态页');
}
const statusText = readFileSync(STATUS_PAGE, 'utf8');

let active = 0;
let terminal = 0;
const ids = new Map(); // 任务 ID → 文件位置（查重 + 幽灵登记反查）

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
    if (id) registerId(id, `tasks/${dir}/${f}`);
  }
}

// 孤儿问责范围 = git index（已 add/提交）；git 不可用时 fail-closed 全视为已入库
const lsFiles = spawnSync('git', ['ls-files', '--', TASKS_REL], { cwd: ROOT, encoding: 'utf8' });
const trackedCards =
  lsFiles.status === 0 ? new Set(lsFiles.stdout.split(/\r?\n/).filter(Boolean)) : null;

// 4. 顶层：只放活跃卡；活跃卡必须登记状态页（防孤儿，D-111 同型收窄）
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
    const tracked = trackedCards === null || trackedCards.has(`${TASKS_REL}/${f}`);
    if (tracked) {
      fail(`tasks/${f}：活跃任务未登记 project-status.md（孤儿——新会话无法发现它）`);
    } else {
      console.warn(`check-docs: 提醒 tasks/${f} 未登记 project-status.md（未 add 草稿，add/提交前须登记）`);
    }
  }
}

// 5. 幽灵登记：状态页上的 ID 必须对应现存卡（含终态）——索引反向同样会腐烂
for (const ref of new Set(statusText.match(ID_TOKEN) ?? [])) {
  if (!ids.has(ref)) {
    fail(`project-status.md：登记了「${ref}」但没有对应任务卡（幽灵登记——先修卡或删登记，不要倒填空卡）`);
  }
}

// 6. 决策条目四字段完整性
let decisionCount = 0;
if (!existsSync(DECISION_LOG)) {
  fail('docs/decisions/decision-log.md 不存在——脚手架文件不齐，四字段无处校验');
} else {
  const logText = readFileSync(DECISION_LOG, 'utf8');
  let section = '';
  let entryId = null;
  const entries = new Map();
  for (const line of logText.split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      section = line.slice(3).trim();
    } else if (/^###\s+D-\d+/.test(line)) {
      entryId = line.match(/^###\s+(D-\d+)/)[1];
      entries.set(entryId, { section, fields: new Set() });
    } else if (entryId) {
      const field = line.match(FIELD_LINE)?.[1];
      if (field) entries.get(entryId).fields.add(field.trim());
    }
  }
  if (entries.size === 0) {
    fail('decision-log：未解析到任何「### D-NNN」条目——首条决策（如「引入本治理体系」）应随脚手架落地');
  }
  for (const [id, { section: sec, fields }] of entries) {
    decisionCount++;
    for (const req of REQUIRED_FIELDS) {
      if (!fields.has(req)) fail(`decision-log ${id}：缺少「**${req}**」字段`);
    }
    if (sec.startsWith('被否决') && !fields.has('重开条件')) {
      fail(`decision-log ${id}：被否决类条目缺少「**重开条件**」`);
    }
  }
}

// 7. 入口文档死链
for (const doc of ENTRY_DOCS) {
  const full = join(ROOT, doc);
  if (!existsSync(full)) continue; // 被仓库形状裁剪的入口文件不查
  const text = readFileSync(full, 'utf8');
  for (const [, link] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^(https?:|mailto:|#)/.test(link)) continue;
    const path = link.split('#')[0];
    if (!path) continue;
    let target;
    try {
      target = decodeURIComponent(path);
    } catch {
      target = path;
    }
    if (!existsSync(resolve(dirname(full), target))) fail(`${doc}：死链 ${link}`);
  }
}

if (problems.length) {
  console.error(`check-docs: FAIL（${problems.length} 处）\n` + problems.map((p) => `  - ${p}`).join('\n'));
  process.exit(1);
}
console.log(`check-docs: PASS（活跃 ${active} / 终态 ${terminal} / 决策 ${decisionCount} 条，入口文档无死链）`);
