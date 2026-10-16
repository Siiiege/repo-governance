# repo-governance 维护纪律

> 本文件面向在本仓库目录内工作的会话（维护迭代、贡献者改 PR）。skill 的使用者
> 读不到它：触发 skill 加载的是 SKILL.md，本文件只在仓库内会话自动生效。
> 维护规则一律写这里——写进 SKILL.md 会进每次触发的上下文，稀释 skill 语义。

## 仓库地图

单人维护的 skill 仓库，产品是给 agent 执行的指令文本。改动前先归位：

| 类别 | 文件 | 说明 |
| --- | --- | --- |
| 产品 | `SKILL.md`、`README.md` | 使用者直接读 |
| 分发资产 | `assets/` 四件 | 原样复制进目标仓库；`development.md` 是分发的任务闭环细则，本仓库自身流程以本文件为准 |
| 技能内参考 | `references/repo-shapes.md` | 按需读，不复制进目标仓 |
| 迭代留痕 | `docs/evaluation.md` | 实测记录与设计变更，README 实测节的事实源 |
| 维护设施 | `test-gate.sh` | 门禁资产的行为回归（13 组 × 2 运行时） |

本仓库自身的治理就是这份轻量文件，没有任务卡与状态页；在本仓库内再套
repo-governance 全套属于误判。

## 硬约束

- **事实可回查**：写进任何文件的数字、出处、实测占比，必须能指认 git 历史、
  命令输出或仓内文件；指认不了的删表述，空缺优于虚构。
- **访客假设**：命令与示例按无 SSH key、无本机配置的公网访客写——仓库地址
  一律 HTTPS。

## 验证纪律

「完成」只认命令输出。动了门禁相关文件的，收尾前 `bash test-gate.sh` 退出码 0
且 `unexpected=0`。

触发判定：动 `assets/check-docs.*`、`assets/_template.md` 的 gate 行、或
`test-gate.sh` 本身任何一行 = 必跑；纯散文改动（SKILL.md / README.md 措辞）
免跑——它的防线是上面的事实可回查。改门禁行为时同轮给 `test-gate.sh` 加用例
（先例：幽灵提交号检查，11 → 13 组）。

autocrlf 环境下 `git add` 的 LF→CRLF warning 是本机噪音，不是失败信号。

## 联动清单

| 改这里 | 同步这里 |
| --- | --- |
| `check-docs.mjs` 或 `check-docs.py` | 另一份行为一致同轮改 + 跑 `test-gate.sh` |
| `_template.md` gate 行 | 跑 `test-gate.sh`（枚举/目录用例压住） |
| 门禁规则语义 | `assets/development.md` 对应细则 + `test-gate.sh` 用例 |
| SKILL.md 调参点节 | `assets/` 实际常量（`TEMPLATE_NAME` / `SKIP_TOP` / `ID_TOKEN`） |
| 设计级变更 | `docs/evaluation.md` 追加一节留痕 |

## 措辞

平实、问题导向：动宾具体，一事一句。装饰性量词（「三十七次」「大量」）与格言
句式，换成可回查的具体事实或删掉。README 开头先写读者的问题，再写怎么解决。

## 对外与提交

- 提交信息 Conventional Commits + 中文描述；commit / push 由属主明确发起。
- 安装方式、仓库定位、README 结构级重写：先在会话里过属主确认再动手。
