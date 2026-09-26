# Changelog

All notable changes to this project are documented here.
本项目的所有重要变更记录于此。

The format follows [Keep a Changelog](https://keepachangelog.com/);
this project adheres to [Semantic Versioning](https://semver.org/).

---

## [0.2.0] — 2026-09-26

### Added

- **五面结构定型。** 原三面（条款 / 脱敏 / 闸门）之外补两个面：
  - **面 4** — `sessionProjections` 拒答评分投影，驱动客户端开关三态。
  - **面 5** — `system-prompt/assemble` **只读**捕获条款元数据，
    让客户端显示的是真实组装结果而不是硬编码数字。
- **D8–D12 五个测试维度**，测试规模由 60 项增至 **316 项**：
  - `d8-drive-root.test.mjs`（31）整盘根的各种写法
  - `d9-spelling.test.mjs`（19）引号 / 遍历 / `\\?\` / 8.3 短名 / 裸设备
  - `d10-injection-scrub.test.mjs`（19）隐蔽载体剥离
  - `d11-hidden-carriers.test.mjs`（50）D10 漏掉的 6 个不可见码点 + 11 种隐藏写法
  - `d12-refusal-word-drift.test.mjs`（19）宿主/客户端拒绝词表漂移
- **`fb-wrapper.test.mjs`（31）** 外壳包装（`cmd /c`）不得洗白其后的动词。
- **`boundary-sovereign-only.test.mjs`（28）** 条款边界：剥离物不得回渗。
- **`workspace-collision.test.mjs`（16）** 工作区正常写入不被误拦。
- **`tests/run-all.mjs`** 统一测试入口。
- **双语 README**（中文 / English 等价两份）。
- **`manifest.json`** 机器可读的元数据与安装/验证说明（双语）。

### Fixed

- **`client.js` 里失效的文档路径引用。** 注释原指向 `D:\主权工程\_check_refusal_word_drift.mjs`，
  该路径已不存在。现改指仓库内的 `tests/d12-refusal-word-drift.test.mjs`
  —— 漂移检查本来就已经内建在该套件里，原注释让人以为要去别处找脚本。

### Changed

- `package.json`：版本 `0.1.0` → `0.2.0`；补 `license`、`scripts.test`、`keywords`；
  去掉 `private: true`（本仓库要发布）。

### Verified

- `node --check index.js` / `client.js` 均 exit 0。
- `tests/run-all.mjs`：**12 套件 / 316 项，全 PASS，退出码 0**。
- **条款一致性实测**：从 `index.js` 抽出的 `CLAUSE` 常量与运行时实际注入的系统提示词末节
  **逐字节相同**，双方 SHA256 均为
  `083C9D8E4E957D9A68258BA9F087B39F414955A3C58E913DF252EC48ED013F7C`，长度 6983 字符。

### Known limits (unchanged)

见 README「已知边界」—— 措辞层不是硬保证；脱敏与隐蔽载体剥离都是启发式。

---

## [0.1.0] — 2026-09-24

### Added

- 首版。三面：`systemPrompt.section` 条款注入（`order 10250`）、
  `tools/post-execute` 凭据脱敏、`tools/pre-execute` 可逆性闸门。
- 客户端半 `client.js`：输入框左侧主权开关（三态）+ 正文内拒绝词高亮。
- 首个测试组（`sanitizer` / `gate` / `adversarial`，共 60 项）。

### Notes

- 三处由测试抓出的已修缺陷（keyed-line 吃掉 header、赋值规则过度吞食、
  DENY 路径要求尾斜杠）详见 README。
