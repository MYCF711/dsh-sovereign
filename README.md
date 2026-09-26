# dsh-sovereign

**v0.2.0** · Host-plane sovereignty clause + content guard for [DSH (DeepSeek Harness)](https://github.com/deepseek-ai)

> 宿主平面主权条款与内容守卫 · 挂在 profile 的 bundle 层 · **对全部 agent preset 生效**
>
> **Language / 语言：** [中文](#中文) · [English](#english) — 两份说明内容等价，任选其一阅读。

---

## 中文

### 这是什么

一个 DSH 宿主平面插件。它做三件事，全部随会话自动生效，不需要用户切换任何「模式」：

| 面 | 挂载点 | 作用 |
|---|---|---|
| **面 1** | `systemPrompt.section` @ `order 10250` | 把主权条款作为**系统提示词的最后一节**注入 |
| **面 2** | `tools/post-execute` | 清洗进入上下文的工具结果（凭据脱敏 + 隐蔽载体剥离） |
| **面 3** | `tools/pre-execute` | 按**可逆性**裁决危险操作（PASS / ASK / DENY） |
| **面 4** | `sessionProjections` | 拒答评分投影，驱动客户端开关的三态显示 |
| **面 5** | `system-prompt/assemble` | **只读**捕获条款元数据，供客户端显示真实组装结果 |

客户端半（`client.js`）另加一个输入框左侧的主权开关，以及正文内拒绝词高亮。

### 为什么是宿主平面，而不是 agent preset

需求是「**任何模式的会话都有主权能力**」，不是「做一个叫主权模式的 agent」。

| | agent preset | **本插件** |
|---|---|---|
| 作用域 | 一个会话，可被切换/替换 | **宿主平面，所有会话** |
| 谁能改 | 用户换 preset 就没了 | 只有改 profile 配置才能改 |
| 载体正确性 | ❌「保证」会随 preset 选择消失 | ✅ 保证不随会话变化 |

**一个「用户换个模式就失效」的保证，不是保证。** 所以它必须落在 host 平面。

### 为什么 `order 10250`

`SECTION_ORDERS`（`dsh-system-prompt`）里 `DEPLOYMENT_PERSONA_SUFFIX = 10200`，
仓库自身最高的是 `WEB_SURFACE = 10100`。

**10250 排在所有仓库 section 和 persona suffix 之后 ⇒ 这是对话开始前模型读到的最后一段文字。**
在没有 `complete: true` 的前提下，「近因」是唯一可用的位置优势。

**⚠ 刻意不使用 `complete: true`**：那个标记会让运行时在 waterfall 之后
**把整个 sections 数组替换成只有它自己**，即抹掉 Cordis 文档与全部工具指导。得不偿失。

**⚠ section 名 `sovereign:clause` 是独有命名**：同名 section 后注册者 shadow 先注册者。
只要不叫 `deployment:persona-prefix` 或 `agent-instructions`，**任何 preset 都顶不掉它**。

### 安装

```powershell
# 1) 把插件放进 profile
$profile = "$env:APPDATA\in.dsh-plug.dsh-launcher\homes\<版本>\profiles\web"
Copy-Item -Recurse -Force .\dsh-sovereign "$profile\node_modules\dsh-sovereign"
```

2) 编辑 `$profile\package.json`，**两处都要加**（缺一不可）：

```json
{
  "dependencies": {
    "dsh-sovereign": "file:./node_modules/dsh-sovereign"
  },
  "dsh": {
    "profile": {
      "bundles": [ "...", "dsh-sovereign" ]
    }
  }
}
```

3) **重启 profile。**

> ⚠ **重启是必需的。** 插件在 boot 时加载：
> - **当前会话不会变** —— 插件是 boot 时挂载的
> - `patchReload: "live"` 只对**已有** bundle 的 patch 生效，不负责加载新包
> - 新会话/重启后自动生效

**为什么 `bundles` 里排在载荷插件之前**：本插件是防御方。防御先注册，
后续载荷不会覆盖它的 `post-execute` / `pre-execute` 监听。

### 验证生效

重启后应看到启动日志：

```
[sovereign] clause injected at order 10250; sanitizer, gate and refusal projection armed
```

再确认系统提示词末节存在。**本仓库的验证方式是逐字节比对**：

```powershell
# 从 index.js 抽出 CLAUSE 常量并算 SHA256，与运行时真实组装结果对照
node -e "import('./index.js').then(m=>console.log(require('crypto').createHash('sha256').update(m.CLAUSE).digest('hex').toUpperCase()))"
```

该值应与实际注入的末节文本逐字节相同（条款长度 6983 字符）。

### 三档裁决：可逆性，不是破坏力大小

**判定轴是可逆性。**

| 档 | 判据 | 例 |
|---|---|---|
| **PASS**（默认） | 可逆 | 读文件、写工作区、装包、`git log/diff`、GET 抓取 |
| **ASK** | 不可逆但可存活 | 删除、`git push`、`setx`/`reg add`、停进程、POST 外发 |
| **DENY** | **没有回退路径** | 毁运行时、毁插件实例、格盘、`bcdedit`、删盘根 |

**DENY 档的共同点不是「损失大」，是「已经没有回退路径了」** ——
DSH 的修复工具就住在被毁的那个 `node_modules` 里。

**⚠ 读操作不查路径表。** 路径出现在命令里 ≠ 要写它。
早期版本曾把 `Get-ChildItem D:\DSH-X\data\versions` 判成 DENY ——
会挡住本项目赖以取证的那类只读操作。现在只有出现破坏性动词才查路径表。

### 测试

```powershell
cd tests
Get-ChildItem -Filter "*.test.mjs" | ForEach-Object { & node $_.FullName }
```

**当前状态：12 套件 / 316 项全 PASS。**

| 套件 | 项数 | 覆盖 |
|---|---|---|
| `sanitizer.test.mjs` | 14 | 凭据形状脱敏，散文不误伤 |
| `gate.test.mjs` | 45 | 三档裁决 + 大量「不许过度拦截」回归 |
| `adversarial.test.mjs` | 18 | 改拼写绕 DENY、正常操作不误伤 |
| `d8-drive-root.test.mjs` | 31 | 整盘根，各种写法 |
| `d9-spelling.test.mjs` | 19 | 引号 / 遍历 / `\\?\` / 8.3 短名 / 裸设备 |
| `d10-injection-scrub.test.mjs` | 19 | 隐蔽载体剥离，可见散文必须存活 |
| `d11-hidden-carriers.test.mjs` | 50 | D10 漏掉的 6 个不可见码点 + 11 种隐藏写法 |
| `d12-refusal-word-drift.test.mjs` | 19 | 宿主/客户端拒绝词表漂移 + 最长优先 |
| `fb-wrapper.test.mjs` | 31 | 外壳包装（`cmd /c`）不得洗白其后的动词 |
| `regression-20260924.test.mjs` | 26 | 真实崩过的点，红-绿留痕 |
| `workspace-collision.test.mjs` | 16 | 工作区正常写入不被误拦 |
| `boundary-sovereign-only.test.mjs` | 28 | 条款边界：剥离物不得回渗 |

**测试覆盖的是真实崩过的点，不是想象的点。** 已知缺陷都由测试抓出：

| 缺陷 | 症状 | 修法 |
|---|---|---|
| keyed-line 吃掉 header | `Authorization: Bearer abc…` 只掩了 `Bearer`，**令牌明文漏出**，还挂着 `«REDACTED»` 标签 | 形状规则先跑，赋值规则后跑 |
| 赋值规则过度吞食 | `curl -H 'Authorization: Basic …'` 把 `curl -H '` 也吞了 | 要求值不含空白 + 行尾锚定 |
| DENY 路径要求尾斜杠 | `…\node_modules`（无尾斜杠）落到 ASK，**会给用户一个删掉本守卫自己的按钮** | 所有 DENY 路径尾部斜杠可选 |
| D12 词表漂移 | 9 句真实拒答里 **5 句**被判拒答却一个词都不标红 | 客户端表以宿主表为超集展开，并加漂移测试 |

**第一条最值得记**：脱敏规则自己制造了「已脱敏」的假象，
**比不脱敏更危险** —— 因为它让人以为秘密已经安全了。

### 已知边界（诚实声明）

1. **不保护聊天式拒答。** 本插件能改提示词和工具结果，**改不了模型的采样过程**。
   面 1 是提高服从概率的**措辞层**，不是硬保证。
2. **提示词注入是概率对抗。** 面 2 清洗凭据与隐蔽载体，
   **不清洗语义注入**（「忽略以上指令」类文本）。面 1 的来源判定条款负责语义侧，但仍是模型自判。
3. **脱敏是启发式，不是完备。** 覆盖已知形状；自创格式的密钥可能漏过。
4. **路径表是枚举，不是形式化验证。** 未知的破坏方式可能不在表内。
5. **隐蔽载体剥离是启发式。** 覆盖 `tests/d10`、`tests/d11` 列出的形态；新载体需补测试。

### 回滚

```powershell
# 从 bundles 数组删掉 "dsh-sovereign" 一行再重启。
# 插件目录可以留着不删 —— 不注册就不生效。
```

### 版本

| 版本 | 变更 |
|---|---|
| **0.2.0** | 五面结构定型；D8–D12 五个维度的测试补齐（316 项）；修正 `client.js` 中已失效的文档路径引用 |
| 0.1.0 | 首版：三面（条款 / 脱敏 / 闸门） |

### 文件

```
dsh-sovereign/
├── package.json            ← dsh.bundle.patch 指向 cordis.patch.yml
├── cordis.patch.yml        ← 4 行：insert 本插件
├── index.js                ← 宿主面全部实现（单文件，纯 JS，零依赖）
├── client.js               ← 客户端半：开关按钮 + 拒绝词高亮
├── README.md               ← 本文件
└── tests/                  ← 12 套件 / 316 项
```

---

## English

### What this is

A host-plane DSH plugin. It does three things, all active automatically in every session,
with no "mode" for the user to switch into:

| Face | Hook | Effect |
|---|---|---|
| **1** | `systemPrompt.section` @ `order 10250` | Injects the sovereignty clause as the **last section of the system prompt** |
| **2** | `tools/post-execute` | Sanitizes tool results on their way into the context (credential masking + hidden-carrier scrubbing) |
| **3** | `tools/pre-execute` | Rules on dangerous operations by **reversibility** (PASS / ASK / DENY) |
| **4** | `sessionProjections` | Refusal score projection, driving the client toggle's three states |
| **5** | `system-prompt/assemble` | **Read-only** capture of clause metadata so the client can show the real assembly |

The client half (`client.js`) adds a sovereignty toggle left of the composer plus
in-transcript highlighting of refusal phrases.

### Why host plane rather than an agent preset

The requirement is "sovereignty in **every** session, whatever preset it runs",
not "an agent named sovereign-mode".

| | agent preset | **this plugin** |
|---|---|---|
| Scope | one session, selectable and replaceable | **host plane, every session** |
| Who can change it | gone the moment the user picks another preset | only by editing the profile config |
| Correctness of the carrier | ❌ the "guarantee" disappears with the preset | ✅ the guarantee does not vary per session |

**A guarantee that disappears when the user picks a different preset is not a guarantee.**
So it has to live on the host plane.

### Why `order 10250`

In `SECTION_ORDERS` (`dsh-system-prompt`), `DEPLOYMENT_PERSONA_SUFFIX = 10200`,
and the highest repository order is `WEB_SURFACE = 10100`.

**10250 sorts after every repository section and after the persona suffix ⇒ this is the
last text a model reads before the conversation begins.** Without `complete: true`,
recency is the only positional advantage available.

**⚠ `complete: true` is deliberately NOT used**: that flag makes the runtime
**replace the whole sections array with only itself** after the waterfall,
wiping the Cordis docs and all tool guidance. Not worth it.

**⚠ The section name `sovereign:clause` is deliberately unique**: a same-named section
shadows the earlier registrant. As long as it is not called `deployment:persona-prefix`
or `agent-instructions`, **no preset can override it**.

### Install

```powershell
# 1) place the plugin in the profile
$profile = "$env:APPDATA\in.dsh-plug.dsh-launcher\homes\<version>\profiles\web"
Copy-Item -Recurse -Force .\dsh-sovereign "$profile\node_modules\dsh-sovereign"
```

2) Edit `$profile\package.json` — **both places are required**:

```json
{
  "dependencies": {
    "dsh-sovereign": "file:./node_modules/dsh-sovereign"
  },
  "dsh": {
    "profile": {
      "bundles": [ "...", "dsh-sovereign" ]
    }
  }
}
```

3) **Restart the profile.**

> ⚠ **The restart is mandatory.** The plugin loads at boot:
> - **The current session will not change** — the plugin is mounted at boot
> - `patchReload: "live"` only applies patches to **existing** bundles; it does not load new packages
> - New sessions / after restart it is active automatically

**Why it precedes the payload plugin in `bundles`**: this plugin is the defense side.
Registering defense first means a later payload will not override its
`post-execute` / `pre-execute` listeners.

### Verifying it is armed

After a restart you should see the boot line:

```
[sovereign] clause injected at order 10250; sanitizer, gate and refusal projection armed
```

Then confirm the last section of the system prompt. **This repository verifies by
byte-for-byte comparison**:

```powershell
# Extract the CLAUSE constant from index.js and hash it, comparing against the
# runtime's real assembly result
node -e "import('./index.js').then(m=>console.log(require('crypto').createHash('sha256').update(m.CLAUSE).digest('hex').toUpperCase()))"
```

The value should be byte-identical to the injected final section (clause length 6983 characters).

### Three verdicts: reversibility, not magnitude

**The axis is reversibility.**

| Verdict | Criterion | Examples |
|---|---|---|
| **PASS** (default) | reversible | reading files, writing the workspace, installing packages, `git log/diff`, GET fetches |
| **ASK** | irreversible but survivable | deletions, `git push`, `setx`/`reg add`, stopping processes, POST egress |
| **DENY** | **no recovery path left** | destroying the runtime, destroying the plugin instance, wiping disks, `bcdedit`, deleting a drive root |

**What the DENY tier has in common is not "big loss" — it is "no recovery path left".**
DSH's own repair tools live inside the very `node_modules` being destroyed.

**⚠ Reads never consult the path table.** A path appearing in a command ≠ wanting to write it.
An early version rated `Get-ChildItem D:\DSH-X\data\versions` as DENY —
which would have blocked the very read-only operations this project depends on for evidence.
Only the presence of a destructive verb now triggers the path table.

### Tests

```powershell
cd tests
Get-ChildItem -Filter "*.test.mjs" | ForEach-Object { & node $_.FullName }
```

**Current status: 12 suites / 316 assertions, all PASS.**

| Suite | Count | Covers |
|---|---|---|
| `sanitizer.test.mjs` | 14 | credential-shape masking; prose must survive |
| `gate.test.mjs` | 45 | the three verdicts + heavy "must not over-block" regression |
| `adversarial.test.mjs` | 18 | DENY evasion by spelling; normal work unharmed |
| `d8-drive-root.test.mjs` | 31 | whole drive roots, every spelling |
| `d9-spelling.test.mjs` | 19 | quotes / traversal / `\\?\` / 8.3 short names / bare devices |
| `d10-injection-scrub.test.mjs` | 19 | hidden-carrier removal; visible prose must survive |
| `d11-hidden-carriers.test.mjs` | 50 | the 6 invisible code points D10 missed + 11 hidden spellings |
| `d12-refusal-word-drift.test.mjs` | 19 | host/client refusal-word drift + longest-match-wins |
| `fb-wrapper.test.mjs` | 31 | shell wrappers (`cmd /c`) must not launder the verb after them |
| `regression-20260924.test.mjs` | 26 | points that actually broke, with red-green traces |
| `workspace-collision.test.mjs` | 16 | ordinary workspace writes must not be blocked |
| `boundary-sovereign-only.test.mjs` | 28 | clause boundary: stripped material must not seep back |

**The tests cover points that actually broke, not imagined ones.** Every known defect
was caught by a test:

| Defect | Symptom | Fix |
|---|---|---|
| keyed-line ate the header | `Authorization: Bearer abc…` masked only `Bearer`, **leaking the token in cleartext** while still wearing a `«REDACTED»` label | shape rules run first, assignment rules after |
| assignment rule over-ate | `curl -H 'Authorization: Basic …'` swallowed `curl -H '` too | value must contain no whitespace + anchor at end of line |
| DENY paths required a trailing slash | `…\node_modules` (no trailing slash) fell through to ASK, **handing the user a button that deletes the guard itself** | trailing slash optional on all DENY paths |
| D12 word-table drift | 5 of 9 real refusals were judged a refusal but **not one word got highlighted** | client table expanded to a superset of the host table, plus a drift test |

**The first one is the one worth remembering**: the masking rule created its own
illusion of "already masked", which is **more dangerous than not masking at all** —
because it makes people believe the secret is already safe.

### Known limits (stated honestly)

1. **It does not prevent chat-style refusals.** This plugin can change the prompt and
   tool results; it **cannot change the model's sampling process**. Face 1 is a
   **wording layer** that raises compliance probability, not a hard guarantee.
2. **Prompt injection is probabilistic.** Face 2 cleans credentials and hidden carriers,
   **not semantic injection** ("ignore the above" style text). Face 1's origin clause
   covers the semantic side, but it remains a model judgement.
3. **Masking is heuristic, not complete.** It covers the known shapes; a bespoke
   secret format may slip through.
4. **The path table is an enumeration, not a formal proof.** Unknown destructive
   methods may be missing.
5. **Hidden-carrier scrubbing is heuristic.** It covers the forms listed in
   `tests/d10` and `tests/d11`; a new carrier needs a new test.

### Rollback

```powershell
# Remove the "dsh-sovereign" line from the bundles array and restart.
# The plugin directory can stay — if it does not register, it does not take effect.
```

### Versions

| Version | Changes |
|---|---|
| **0.2.0** | Five-face structure finalized; D8–D12 test dimensions added (316 assertions); fixed a stale documentation path reference in `client.js` |
| 0.1.0 | First release: three faces (clause / sanitizer / gate) |

### Files

```
dsh-sovereign/
├── package.json            ← dsh.bundle.patch points at cordis.patch.yml
├── cordis.patch.yml        ← 4 lines: inserts this plugin
├── index.js                ← the entire host half (single file, plain JS, zero deps)
├── client.js               ← the client half: toggle button + refusal highlighting
├── README.md               ← this file
└── tests/                  ← 12 suites / 316 assertions
```

---

## License

MIT
