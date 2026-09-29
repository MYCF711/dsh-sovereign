// ============================================================================
// probe-complete.mjs — complete:true 侵占后果的实证探针
// ============================================================================
//
// 目的：不靠推理，直接跑真实 dsh-system-prompt 的 assemble()，观察 complete
// section 到底把什么顶掉了。
//
// 做法：用真实的 @deepseek-ai/dsh-system-prompt + 真实 Cordis，注册
//   - 若干普通 section（模拟 harness:identity / 我的 sovereign:clause / 别人的）
//   - 一个 complete:true section
// 然后调用真实 assemble()，打印前后对比。
//
// 为什么必须用真实实现：complete 的处理在 assemble() 内部（:356-361），
// 任何假替身都不会复现那段覆盖逻辑。

import { pathToFileURL } from "node:url";

const BASE = "file:///C:/Users/Administrator/AppData/Roaming/in.dsh-plug.dsh-launcher/versions/0.1.7-rc.2/node_modules/.pnpm";

console.log("=== 1. 加载真实依赖 ===");
let cordis, mod;
try {
  cordis = await import(`${BASE}/@deepseek-ai+cordis@4.0.4_@_f26b922a7ef2f8fed990b442fc983a03/node_modules/@deepseek-ai/cordis/lib/index.js`);
  console.log("  cordis OK");
} catch (e) {
  console.log("  cordis FAIL:", e.message);
  process.exit(1);
}
try {
  mod = await import(`${BASE}/@deepseek-ai+dsh-system-pro_0b21053a74bd21a7376af7f8e3ce6948/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js`);
  console.log("  dsh-system-prompt OK, exports:", Object.keys(mod).join(","));
} catch (e) {
  console.log("  dsh-system-prompt FAIL:", e.message);
  process.exit(1);
}

console.log("");
console.log("=== 2. 建宿主并挂载 SystemPrompt 服务 ===");
const { Context } = cordis;
const app = new Context();

// SystemPrompt 是 Service 子类。用 mod.default 或从导出里找。
const SystemPromptCtor = mod.SystemPrompt ?? mod.default;
if (typeof SystemPromptCtor !== "function") {
  console.log("  找不到 SystemPrompt 构造器。导出：", Object.keys(mod).join(","));
  process.exit(2);
}

let sp;
try {
  // Service 类的常见挂载方式：new Ctor(ctx, config)
  sp = new SystemPromptCtor(app, { includeHarnessIdentity: true, includeRuntimeContext: false });
  console.log("  SystemPrompt 实例化 OK");
} catch (e) {
  console.log("  实例化 FAIL:", e.name, e.message);
  process.exit(2);
}

console.log("");
console.log("=== 3. 注册若干普通 section + 一个 complete section ===");
const registered = [];
function add(name, order, text, extra) {
  try {
    const d = sp.section({ name, order, text, ...(extra ?? {}) });
    registered.push({ name, order, dispose: d });
    console.log(`  + ${name}  order=${order}${extra?.complete ? "  [complete:true]" : ""}`);
    return d;
  } catch (e) {
    console.log(`  ! ${name} 注册失败: ${e.message}`);
    return undefined;
  }
}

add("harness:identity", -1000, "You are an AI agent powered by DeepSeek Harness.");
add("仓库:web-surface", 10100, "WEB SURFACE 段（仓库自带）");
add("deployment:persona-suffix", 10200, "PERSONA SUFFIX 段（仓库自带）");
add("sovereign:clause", Number.MAX_SAFE_INTEGER - 1, "[MODE: SOVEREIGN] 条款正文");
add("第三方:dsh-chinese-language", 10300, "中文语言段（第三方）");
add("第三方:user-baseline-five", 10500, "底线五（第三方）");

/** 跑一次 assemble，返回 { names, count, toolCount } */
async function run(label) {
  try {
    const a = await sp.assemble({});
    const names = a.sections.map((s) => s.name);
    console.log(`  [${label}] sections=${a.sections.length}  names=${names.join(" | ")}`);
    console.log(`  [${label}] tools=${Array.isArray(a.tools) ? a.tools.length : "n/a"}  contexts=${Array.isArray(a.contexts) ? a.contexts.length : 0}`);
    return { names, count: a.sections.length };
  } catch (e) {
    console.log(`  [${label}] assemble 抛错: ${e.name}: ${e.message}`);
    return { error: e.message };
  }
}

console.log("");
console.log("=== 4. baseline：无 complete ===");
const before = await run("无 complete");

console.log("");
console.log("=== 5. 注入一个 complete:true section ===");
add("别人的:complete-hijacker", 999999, "我独占整个系统提示词。", { complete: true });

console.log("");
console.log("=== 6. 再跑 assemble，看被顶掉了什么 ===");
const after = await run("有 complete");

console.log("");
console.log("=== 7. 判定 ===");
if (before.error || after.error) {
  console.log("  有 assemble 抛错，见上。");
} else {
  const lost = before.names.filter((n) => !after.names.includes(n));
  const kept = after.names;
  console.log(`  被顶掉的 section（${lost.length} 个）:`);
  for (const n of lost) console.log(`    - ${n}`);
  console.log(`  存活下来的 section（${kept.length} 个）:`);
  for (const n of kept) console.log(`    + ${n}`);
  console.log("");
  console.log(`  我的 sovereign:clause 是否消失: ${lost.includes("sovereign:clause") ? "是 ← 侵占成立" : "否"}`);
}

console.log("");
console.log("=== 8. 再注入第二个 complete，看是否抛错 ===");
add("第三个:another-complete", 999998, "我也要独占。", { complete: true });
await run("两个 complete");
