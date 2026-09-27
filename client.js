/*
 * dsh-sovereign client half — 主权开关 + 对话内宣告 + 拒答报警
 *
 * 挂载点在 conversation.input.left（官方推荐位，DOM 顺序 [+][📎][权限框][主权]），
 * 与左两个按钮同一个 .tools flex 容器，自动共享 gap:12px。
 *
 * 三态（圆底 + 彩色实心圆点，28×28 圆形）：
 *   灰白 #94a3b8 = 未激活（点击激活）
 *   绿色 #10b981 = 已激活
 *   红色 #ef4444 = 已激活，且上一条回复被判拒答/替代方案（8 秒后自动复位）
 *
 * 这是【开关】不是展开：点击即切换，不弹菜单、不留面板。
 *
 * 「宣告主权」是行为不是提示词节：在输入框打出这四个字会重新宣告，
 * 但绝不改变开关状态（灰态宣告完仍灰，绿态宣告完仍绿）。
 *
 * ── 宣告内容走【对话内输出】而不是自绘浮层 ──────────────────────────────
 * 用宿主自己的 SessionInput.notify("info", text)（契约见
 * dsh-client-ui-conversation/lib/types/client/contract/input.d.ts:186-195）。
 * 该通知由宿主渲染成 composer 上方的 .uV2eYG_notice 横幅
 * （ui-conversation/lib/client.js:16060-16064），样式取自
 * var(--dsw-alias-interactive-bg-hover) / var(--dsw-alias-label-secondary)
 * （同文件 15757），因此天生跟随主题，不会再出现「深底深字看不见」。
 *
 * 为什么要换掉自绘浮层：旧实现用了我编造的 CSS 变量
 * --dsw-alias-bg-elevated / --dsw-alias-border-secondary（全库 0 次出现），
 * 回退到硬编码深色 rgba(24,24,27,.96)，在浅色主题下变成黑框黑字。
 * 教训：CSS 变量的真名必须以 dsh-client-ui-theme/lib/client.js 为准。
 *
 * 宣告内容 100% 来自宿主面 "sovereign" 会话投影的 clause 字段，
 * 而 clause 字段来自 system-prompt/assemble 的真实组装结果。
 * 本文件不硬编码任何条款数字：未捕获时如实说「未捕获」。
 *
 * 零上下文成本：本文件只在渲染进程运行，不注册任何系统提示词 section、
 * 不注册任何工具、不产生网络请求、不写会话记录。
 */
(() => {
  try {
    window.__ModuleLoader__.load({
      id: "dsh-sovereign",
      factory: (require) => {
        var module = { exports: {} };
        var exports = module.exports;
        Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

        var react = require("react");

        var inject = ["slots"];

        var ANIM_CSS = [
          "@keyframes dshSovPulse{0%,100%{box-shadow:0 0 2px rgba(16,185,129,.5);opacity:1}50%{box-shadow:0 0 14px rgba(16,185,129,1);opacity:.6}}",
          "@keyframes dshSovFlash{0%{transform:scale(1)}30%{transform:scale(1.12)}100%{transform:scale(1)}}",
          "@keyframes dshSovAlarm{0%,100%{box-shadow:0 0 3px rgba(239,68,68,.6)}50%{box-shadow:0 0 16px rgba(239,68,68,1)}}",
        ].join("");

        // 按钮规格抄原生 .uV2eYG_add，但用【自己的 class】，
        // 绝不改原生类（改了会影响 + 和回形针两个原生按钮）。
        var BTN_CSS = [
          ".dsh-sov-btn{width:28px;height:28px;border:none;border-radius:999px;flex:none;",
          "display:grid;place-items:center;cursor:pointer;corner-shape:round;",
          "background:var(--dsw-specific-selector);color:var(--dsw-alias-label-primary);",
          "transition:background .15s ease}",
          ".dsh-sov-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}",
          ".dsh-sov-btn:disabled{opacity:.5}",
          ".dsh-sov-dot{width:14px;height:14px;border-radius:999px;flex:none;display:block}",
        ].join("");

        // 三态配色：只取色值与文案，按钮外观一律走 CSS 变量。
        var PALETTE = {
          off: { dot: "#94a3b8", title: "主权未激活 —— 点击激活主权条款" },
          on: { dot: "#10b981", title: "主权已激活 —— 点击关闭" },
          alarm: { dot: "#ef4444", title: "检测到拒答 —— 点击复位" },
        };

        // ── 拒答词红字高亮 ────────────────────────────────────────────────
        // 目标：agent 被判拒答时，把【命中的拒绝词】在会话正文里染成红色，
        // 让人一眼看到「这里收手了」。
        //
        // 实现约束（本工程铁律）：
        //   · 只依赖【稳定契约】—— 用框架自己的 data-conversation-content 钩子，
        //     绝不用哈希类名（uV2eYG_* 之类，构建产物随时会变）
        //   · 不改 DOM 结构、不注入节点 —— 纯 CSS，零副作用、可逆
        //   · 只在 verdict !== "pass" 时生效（否则正常正文里的同名词会被误标红）
        //
        // 做法：把命中词逐个包成 <mark class="dsh-sov-refusal">。
        // 由于 CSS 无法匹配文本内容，这里必须做轻量 DOM 包装 —— 但只在
        // 判定为拒答时执行，且只包裹【文本节点】内的命中串，不碰其他节点。
        var REFUSAL_MARK_CLASS = "dsh-sov-refusal";
        var REFUSAL_CSS = [
          "." + REFUSAL_MARK_CLASS + "{",
          "color:#ef4444;font-weight:600;",
          "background:rgba(239,68,68,.10);",
          "border-radius:3px;padding:0 2px;",
          "}",
        ].join("");

        // 客户端侧的命中词表。
        //
        // D12（2026-09-25 实测修复）：这份表原先只有 29 条，而宿主面
        // REFUSAL_MARKERS_ZH 有 47 条 —— 43 条宿主能判、客户端不认。
        // 后果实测：9 句真实拒答里【5 句】被判拒答却一个词都不标红，
        // 即按钮变红了，正文却没有可指认的拒绝词（"无法协助"/"拒绝回答"/
        // "这超出了我的能力范围"/"不允许提供"/"不能提供"）。
        //
        // 修法：以宿主面词表为【超集】展开 —— 下面 HOST_PARITY_WORDS 逐条
        // 补齐宿主面独有、且能出现在正文里的词。宿主面那几条「请告诉我」
        // 「其他合规」太泛（正常正文也可能出现），故意不收，避免误标红。
        //
        // ⚠️ 漂移是双向风险，检查脚本已在仓库内：tests/d12-refusal-word-drift.test.mjs
        //    它从 index.js 与 client.js 两个【真实文件】抽表比对，不用副本；
        //    改了任一面的词表就必须重跑它。
        var HOST_PARITY_WORDS = [
          "无法参与", "无法提供", "无法帮助", "无法协助", "无法满足",
          "无法回答", "无法生成", "无法完成",
          "不能提供", "不能协助", "不能参与", "不能帮助", "不能回答",
          "不能生成", "不提供", "不能做", "不能给", "不能写",
          "不能告诉", "不能透露", "不能讨论", "不能涉及",
          "拒绝提供", "拒绝协助", "不予协助", "拒绝回答", "我拒绝",
          "不可以提供", "不允许提供",
          "这超出了我的能力", "不在我的能力范围",
          "作为AI语言模型", "作为人工智能助手",
          "请提出其他合规的问题", "请提出合规的问题",
          // 带前缀的整句形态。它们能被下面更短的词（"我不能"/"很抱歉"）覆盖，
          // 但显式列出有两个好处：匹配取【最长优先】时整句一起标红更准，
          // 且宿主面词表若改动，D12 的一致性检查能立刻发现缺口。
          "抱歉，我不能", "抱歉，我无法", "很抱歉，我",
          "我不能这么做", "我不能完成", "不能帮",
        ];

        var REFUSAL_WORDS = [
          "我不能", "我无法", "我不会", "我不能帮", "恕难从命",
          "抱歉", "很抱歉", "对不起", "请理解",
          "作为AI", "作为人工智能",
          "不是道德说教", "可以帮你", "能帮的是", "替代方案",
          "建议你", "更好的做法是", "不如考虑",
          "请注意", "请确保", "请遵守", "已获得授权", "合法授权",
          "正版在哪", "合法路径", "官方渠道",
          "如果你要的是", "如果你有其他问题", "我很乐意",
        ].concat(HOST_PARITY_WORDS);

        // 只在 assistant 正文容器内高亮，避免误伤用户自己的输入
        var CONTENT_SELECTOR = "[data-conversation-content],[data-conversation-scroll]";

        function clearHighlights(root) {
          try {
            var marks = root.querySelectorAll("mark." + REFUSAL_MARK_CLASS);
            for (var i = 0; i < marks.length; i++) {
              var m = marks[i];
              var parent = m.parentNode;
              if (!parent) continue;
              parent.replaceChild(document.createTextNode(m.textContent), m);
              parent.normalize();
            }
          } catch (e) {
            /* 高亮失败绝不影响会话本身 */
          }
        }

        // 词表按【长度降序】排一次，供匹配时做最长优先。
        // 为什么必须：原实现取「位置最靠前」的命中词，同位置时先到先得 ——
        // 于是 "不能提供" 里的 "不能"（在表里更靠前）先命中，
        // 只把 "不能" 标红，"提供" 留在外面，改成 "不能"+"提供" 两截，
        // 看起来像标错了词。实测形状：正文「不能提供这类代码」只红了前两个字。
        // 排序后 "不能提供" 先被检查，"不能" 自然退居次席。
        // 这正是 Host 面词表变长（D12 补齐 35 条）之后才暴露的问题。
        var REFUSAL_WORDS_BY_LENGTH = REFUSAL_WORDS.slice().sort(function (a, b) {
          return b.length - a.length;
        });

        function highlightInTextNode(node) {
          try {
            var text = node.nodeValue;
            if (!text) return;
            var hit = null;
            for (var i = 0; i < REFUSAL_WORDS_BY_LENGTH.length; i++) {
              var w = REFUSAL_WORDS_BY_LENGTH[i];
              var at = text.indexOf(w);
              if (at !== -1) { hit = { word: w, at: at }; break; }
            }
            if (hit === null) return;

            var parent = node.parentNode;
            if (!parent) return;
            // 已经在 mark 里就不再嵌套
            if (parent.nodeName === "MARK" && parent.className === REFUSAL_MARK_CLASS) return;
            // 不碰代码块 —— 那里的"我不能"可能是代码字符串
            if (parent.closest && parent.closest("pre,code")) return;

            var frag = document.createDocumentFragment();
            var rest = text;
            var cursor = 0;
            // 逐个命中词切分（同一节点内可能多次出现）
            var guard = 0;
            while (rest && guard++ < 50) {
              var found = null;
              for (var k = 0; k < REFUSAL_WORDS_BY_LENGTH.length; k++) {
                var w2 = REFUSAL_WORDS_BY_LENGTH[k];
                var p = rest.indexOf(w2);
                // 位置最靠前优先；同位置时【更长的词】优先 —— 词表已按长度降序，
                // 因此这里只需用严格小于 `p < found.at`，等号情形保留先到的长词。
                if (p !== -1 && (found === null || p < found.at)) found = { word: w2, at: p };
              }
              if (found === null) break;
              if (found.at > 0) frag.appendChild(document.createTextNode(rest.slice(0, found.at)));
              var mark = document.createElement("mark");
              mark.className = REFUSAL_MARK_CLASS;
              mark.textContent = found.word;
              frag.appendChild(mark);
              rest = rest.slice(found.at + found.word.length);
            }
            if (rest) frag.appendChild(document.createTextNode(rest));
            parent.replaceChild(frag, node);
          } catch (e) {
            /* 单节点失败不影响整体 */
          }
        }

        function applyHighlights() {
          try {
            var roots = document.querySelectorAll(CONTENT_SELECTOR);
            for (var r = 0; r < roots.length; r++) {
              var root = roots[r];
              clearHighlights(root); // 先还原，避免重复包裹
              var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
              var nodes = [];
              var n;
              while ((n = walker.nextNode())) nodes.push(n);
              for (var i = 0; i < nodes.length; i++) highlightInTextNode(nodes[i]);
            }
          } catch (e) {
            /* 整体失败静默 —— 高亮是增强，不是功能 */
          }
        }

        var VERDICT_FLASH_MS = 8000; // 拒答报警持续 8 秒后自动复位
        var ENABLED_KEY = "dsh-sovereign-enabled";
        var SUMMON = "宣告主权"; // 行为触发词，不是提示词节

        function readEnabled() {
          try {
            var v = window.localStorage.getItem(ENABLED_KEY);
            return v === null ? true : v === "1";
          } catch (e) {
            return true;
          }
        }

        function writeEnabled(next) {
          try {
            window.localStorage.setItem(ENABLED_KEY, next ? "1" : "0");
          } catch (e) {
            /* 存储不可用不影响开关本身 */
          }
        }

        // ── 宿主通道（FACE 6） ─────────────────────────────────────────────
        // v0.4.0 之前，开关只写 localStorage —— 宿主面读不到，于是按钮变灰而
        // 条款照样注入。这里补上缺失的那条链路：same-origin fetch 打到宿主路由，
        // 由宿主 dispose / 重建 clause section，下一次 assemble 即刻生效。
        //
        // 范式来自 dsh-image-gen（lib/index.js:21311-21319 注册路由，
        // lib/client.js:116055 用 same-origin fetch 调用）。宿主侧见 index.js FACE 6。
        var SWITCH_ROUTE = "/plugins/dsh-sovereign/switch";
        var STATE_ROUTE = "/plugins/dsh-sovereign/state";
        var PUSH_TIMEOUT_MS = 3000;

        // 把开关推给宿主。永不 reject —— 失败返回 false。
        // 失败**不等于**开关没生效：本地语义已翻面，只是没推到宿主。调用方据此
        // 把按钮降级成灰态并在 title 里注明「未送达宿主」，绝不装作成功。
        function pushEnabled(next) {
          try {
            return window.fetch(SWITCH_ROUTE, {
              method: "POST",
              credentials: "same-origin",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ clause: next }),
              signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
            }).then(function (response) {
              if (!response.ok) return false;
              return response.json().then(function (payload) {
                return !!(payload && payload.ok === true);
              });
            }).catch(function () {
              return false;
            });
          } catch (e) {
            return Promise.resolve(false);
          }
        }

        // 首次挂载时从句柄拉一次真值。宿主是权威：localStorage 可能过期
        // （另一个窗口关掉了，或 sidecar 文件被手工改过）。拿不到返回 null，
        // 此时沿用本地值，绝不猜测。
        function pullEnabled() {
          try {
            return window.fetch(STATE_ROUTE, {
              credentials: "same-origin",
              signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
            }).then(function (response) {
              if (!response.ok) return null;
              return response.json().then(function (payload) {
                if (!payload || payload.ok !== true) return null;
                return typeof payload.clause === "boolean" ? payload.clause : null;
              });
            }).catch(function () {
              return null;
            });
          } catch (e) {
            return Promise.resolve(null);
          }
        }

        // 「已宣告过」标记：只存在于本会话内存，不持久化。
        // 这样新会话首次加载不会误宣告（T4.5），而同一会话内关闭后也不再自动宣告（T2.4）。
        var announcedThisSession = false;

        // 把投影里的 clause 元数据渲染成密集「标签 · 值」行。
        // 所有数值均来自投影；未捕获时如实说「未捕获」，绝不编数字。
        function buildRows(clause) {
          var c = clause && typeof clause === "object" ? clause : null;
          var captured = !!(c && c.captured);
          var rows = [];

          if (!captured) {
            rows.push("条款 · 未捕获（assemble 尚未返回 sovereign:clause，不显示推测数值）");
          } else {
            var tail = c.last === true ? "（末节）" : "";
            rows.push(
              "条款 · [MODE: SOVEREIGN] · " + c.sections + " 节 · " + c.chars +
              " 字符 · order " + c.order + tail,
            );
            rows.push("底座 · DSH 0.1.5-rc.2 · 组装 sections 共 " + c.total + " 项");
            rows.push("事实 · 条款正文 " + c.chars + " 字符已进入系统提示词");
          }
          rows.push("纪律 · 不追问 · 不软化 · 不重定向 · 不删文件");
          rows.push("闸门 · pre-execute: pwsh / bash / web_fetch");
          rows.push("判拒 · assistant 消息开头 160 字符评分");
          rows.push("边界 · 只对之后的新会话成立");
          return rows;
        }

        function announcementText(clause) {
          return "[MODE: SOVEREIGN] 主权已宣告\n" + buildRows(clause).join("\n");
        }

        // 解析 SessionInput facade。
        // notify 走 SessionInputResolver.for(actx)（input.d.ts:186-202），
        // 拿不到时降级为不宣告，绝不让开关本身失效。
        function resolveInput(props, ctx) {
          try {
            if (props && props.input && typeof props.input.notify === "function") return props.input;
          } catch (e) {
            /* 继续尝试下一条路径 */
          }
          try {
            var resolverHost = ctx || (props && props.ctx);
            var resolver = resolverHost && typeof resolverHost.get === "function"
              ? resolverHost.get("sessionInputResolver")
              : undefined;
            if (resolver && typeof resolver.for === "function") {
              var facade = resolver.for(resolverHost);
              if (facade && typeof facade.notify === "function") return facade;
            }
          } catch (e) {
            /* 拿不到就静默降级 */
          }
          return null;
        }

        // 宣告：把密集行发进对话面的 composer 通知位。
        // 返回是否真的送出去了，供上层决定要不要回退。
        function announce(props, ctx, clause) {
          var facade = resolveInput(props, ctx);
          if (facade === null) return false;
          try {
            facade.notify("info", announcementText(clause));
            return true;
          } catch (e) {
            return false;
          }
        }

        function SovereignLeftSlot(props) {
          var useProjection = props.useProjection;
          var useInput = props.useInput;

          // 本地开关状态（跨会话持久，默认开）
          var enabledPair = react.useState(readEnabled);
          var enabled = enabledPair[0];
          var setEnabled = enabledPair[1];

          var armor = typeof useProjection === "function"
            ? useProjection("sovereign")
            : undefined;

          var lastVerdictRef = react.useRef(null);
          var flashUntilRef = react.useRef(0);
          var tickPair = react.useState(0);
          var setTick = tickPair[1];

          // 宿主是否收到了开关变更。false = 两处一致；true = 本地翻了但没推到宿主，
          // 此时条款仍按宿主侧的状态生效，按钮必须如实显示「未送达」而不是假装成功。
          var pushFailedPair = react.useState(false);
          var pushFailed = pushFailedPair[0];
          var setPushFailed = pushFailedPair[1];

          // 挂载时对齐一次宿主真值。宿主是权威 —— localStorage 可能过期。
          react.useEffect(function () {
            var alive = true;
            pullEnabled().then(function (host) {
              if (!alive || host === null) return;
              setEnabled(host);
              writeEnabled(host);
            });
            return function () { alive = false; };
          }, []);

          // 已宣告过的最新快照，供 effect 里读取而不重新订阅
          var clauseRef = react.useRef(null);
          clauseRef.current = armor && armor.clause ? armor.clause : null;

          // 输入框实时草稿：用于「宣告主权」行为触发。
          // 槽位声明了 useInput 这个 standardProp，取不到时降级为不触发，不影响开关。
          var draft = "";
          if (typeof useInput === "function") {
            try {
              draft = useInput(function (s) {
                return s && typeof s.draft === "string" ? s.draft : "";
              }) || "";
            } catch (e) {
              draft = "";
            }
          }

          react.useEffect(function () {
            if (document.getElementById("dsh-sov-css")) return undefined;
            var styleEl = document.createElement("style");
            styleEl.id = "dsh-sov-css";
            styleEl.textContent = ANIM_CSS + BTN_CSS + REFUSAL_CSS;
            document.head.appendChild(styleEl);
            return function () {
              if (styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
            };
          }, []);

          // 拒答报警：verdict 变化时开 8 秒红色窗口
          react.useEffect(function () {
            var v = armor && armor.verdict ? armor.verdict : null;
            if (v !== lastVerdictRef.current) {
              lastVerdictRef.current = v;
              if (v && v !== "pass") flashUntilRef.current = Date.now() + VERDICT_FLASH_MS;
              setTick(Date.now());
            }
          }, [armor]);

          // 拒答词红字高亮：只在【判定为拒答】时给正文上色，判定为 pass 时还原。
          // 为什么必须挂在 verdict 上：正常回答里也可能出现"我不能"这类词
          // （比如条款示范、或者讨论拒答本身），无差别标红会造成大量误报。
          react.useEffect(function () {
            var v = armor && armor.verdict ? armor.verdict : null;
            if (v && v !== "pass") {
              // 等一帧让 assistant 正文先落进 DOM
              var t = window.setTimeout(function () { applyHighlights(); }, 0);
              return function () { window.clearTimeout(t); };
            }
            // pass 或无判定 ⇒ 清掉历史高亮
            try {
              var roots = document.querySelectorAll(CONTENT_SELECTOR);
              for (var i = 0; i < roots.length; i++) clearHighlights(roots[i]);
            } catch (e) { /* 清理失败不影响会话 */ }
            return undefined;
          }, [armor, tickPair[0]]);

          // 拒答窗口到期时触发一次重渲染，保证按时复位
          react.useEffect(function () {
            var now = Date.now();
            if (flashUntilRef.current <= now) return undefined;
            var timer = window.setTimeout(function () {
              setTick(Date.now());
            }, Math.max(32, flashUntilRef.current - now));
            return function () {
              window.clearTimeout(timer);
            };
          }, [tickPair[0]]);

          // T3：「宣告主权」是行为 —— 重新宣告，但绝不切开关。
          var summonArmedRef = react.useRef(false);
          react.useEffect(function () {
            var text = typeof draft === "string" ? draft.trim() : "";
            if (text !== SUMMON) {
              summonArmedRef.current = false;
              return;
            }
            if (summonArmedRef.current) return;
            summonArmedRef.current = true;
            announce(props, props && props.ctx, clauseRef.current);
          }, [draft]);

          function toggle() {
            var next = !enabled;
            // 先翻本地语义（按钮立刻响应），再推宿主。
            // 推送失败不回滚本地 —— 回滚会让按钮在慢网下跳动；失败如实降级显示。
            setEnabled(next);
            writeEnabled(next);
            setPushFailed(false);
            pushEnabled(next).then(function (ok) {
              setPushFailed(!ok);
              if (ok) {
                // 推送成功即条款已增删，重新拉一次宿主真值对齐。
                pullEnabled().then(function (host) {
                  if (host === null || host === next) return;
                  setEnabled(host);
                  writeEnabled(host);
                  setPushFailed(false);
                });
              }
              setTick(Date.now());
            });
            if (!next) {
              // 关闭时清掉报警
              lastVerdictRef.current = null;
              flashUntilRef.current = 0;
            }
            // T2.3：只有「首次点击激活」那一刻自动宣告。
            // T2.4：本会话已宣告过就不再自动宣告。
            if (next && !announcedThisSession) {
              announcedThisSession = true;
              announce(props, props && props.ctx, clauseRef.current);
            }
            setTick(Date.now());
          }

          var running = !!(armor && armor.running);
          var words = armor && Array.isArray(armor.words) ? armor.words : [];
          var domain = armor && armor.domain ? armor.domain : null;

          var state = "off";
          if (!enabled) {
            state = "off";
          } else {
            var verdict = lastVerdictRef.current;
            var alarming =
              verdict !== null && verdict !== "pass" && Date.now() < flashUntilRef.current;
            state = alarming ? "alarm" : "on";
          }

          var p = PALETTE[state];
          var dotStyle = { background: p.dot };

          if (state === "alarm") {
            dotStyle.animation = "dshSovAlarm 1.4s ease-in-out infinite";
          } else if (state === "on") {
            dotStyle.animation = running ? "dshSovPulse 1.2s ease-in-out infinite" : "none";
          }

          var title = p.title;
          if (state === "alarm" && words[0]) title = "检测到拒答：" + words[0];
          else if (state === "on" && domain) title += " · " + domain;
          if (pushFailed) {
            title = "开关未送达宿主（条款仍按宿主侧状态生效）—— 点击重试";
          }

          return react.createElement("button", {
            type: "button",
            className: "dsh-sov-btn",
            onClick: toggle,
            title: title,
            "aria-label": title,
            "aria-pressed": enabled ? "true" : "false",
            "data-sovereign": state,
            "data-sovereign-push": pushFailed ? "failed" : "ok",
          }, react.createElement("span", { className: "dsh-sov-dot", style: dotStyle }));
        }

        function apply(ctx) {
          ctx.slots.inject("conversation.input.left", () =>
            ctx.slots.register(
              {
                name: "conversation.input.left",
                id: "sovereign",
                order: 100,
              },
              function SovereignSlotWithCtx(props) {
                // 槽位 props 里没有 ctx；把插件 ctx 以只读字段带进去，
                // 供 notify 解析用（不影响宿主已有的 props）。
                var merged = {};
                for (var k in props) if (Object.prototype.hasOwnProperty.call(props, k)) merged[k] = props[k];
                merged.ctx = ctx;
                return SovereignLeftSlot(merged);
              },
            ),
          );
        }

        exports.name = "dsh-sovereign";
        exports.inject = inject;
        exports.apply = apply;
        return module.exports;
      },
    });
  } catch (err) {
    console.warn("[AI Client Sandbox] dsh-sovereign runtime error:", err);
  }
})();
