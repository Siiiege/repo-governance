# repo-governance 维护纪律

`assets/` 整目录是分发面——目标仓库复制走的就是这些字节，改任何一行等于
改动所有已治理仓库。其中 `development.md` 是发给目标仓库的任务闭环细则，
不是本仓库的流程；本仓库的流程只有本文件。

## 提交前逐条核对

1. README「安装」节的地址是
   `https://github.com/Siiiege/repo-governance.git`，示例命令以没有
   SSH key 的访客可以执行为准。
2. README 里的用例组数 × 2 = `test-gate.sh` 实际断言数；改组数两处同轮改。
3. `check-docs.mjs` 与 `check-docs.py` 行为一致：改任一份，同轮把相同
   行为落进另一份。
4. SKILL.md「调参点」提到的常量（`TEMPLATE_NAME`、`SKIP_TOP`、
   `ID_TOKEN`）在两个脚本里真实存在；SKILL.md 引用的每个路径在仓库里存在。
5. 动过 `check-docs.*`、`_template.md` 的 gate 行或 `test-gate.sh` 的提交，
   `bash test-gate.sh` 输出 `unexpected=0`；改门禁行为的提交同轮带新用例。
6. 写进任何文件的数字与出处，能指认到 git 历史、命令输出或仓内文件
   （两次翻车：「三十七次」是编的、SSH 地址是想当然的）。
7. 设计级变更（新增或推翻一条规则）的提交，`docs/evaluation.md` 同轮追加
   一节。新增维护规则写本文件——写进 SKILL.md 会占使用者每次触发的上下文。

autocrlf 下 `git add` 的 LF→CRLF warning 是本机噪音，不是失败信号。
