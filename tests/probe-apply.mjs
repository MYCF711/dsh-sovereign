// ============================================================================
// probe-apply.mjs — 用真实 Cordis 宿主跑一次 apply()，抓出静默失败点
// ============================================================================
//
// 为什么需要这个：集成测试用的是我自己写的假 ctx（effect 立即执行、get 直接返回
// 服务）。假替身不会复现真实 Cordis 的门控行为 —— 比如 `ctx.effect()` 的返回值
// 语义、inject 门控的抛错时机、服务在 fiber 里的可见性。
//
// 本探针加载**真实的** @deepseek-ai/cordis，建一个最小宿主，注册 dsh-sovereign
// 所需的服务（systemPrompt / tools / webServer），然后调用真实的 apply()，
// 逐步打印每个 FACE 是否走通。任何一处抛错都会原样打印堆栈。

import { pathToFileURL } from "node:url";

const CORDIS = "file:///C:/Users/Administrator/AppData/Roaming/in.dsh-plug.dsh-launcher/versions/0.1.7-rc.2/node_modules/.pnpm/@deepseek-ai+cordis@4.0.4_@_f26b922a7ef2f8fed990b442fc983a03/node_modules/@deepseek-ai/cordis/lib/index.js";
const PLUGIN = "file:///C:/Users/Administrator/AppData/Roaming/in.dsh-plug.dsh-launcher/homes/0.1.7-rc.2/profiles/web/node_modules/dsh-sovereign/index.js";

console.log("=== 1. 加载 cordis ===");
let cordis;
try {
  cordis = await import(CORDIS);
  console.log("  OK  exports:", Object.keys(cordis).slice(0, 20).join(","));
} catch (e) {
  console.log("  FAIL:", e.message);
  process.exit(1);
}

console.log("");
console.log("=== 2. 加载插件模块 ===");
let plugin;
try {
  plugin = await import(PLUGIN);
  console.log("  OK  name:", plugin.name, " inject:", JSON.stringify(plugin.inject));
} catch (e) {
  console.log("  FAIL:", e.message);
  process.exit(1);
}

console.log("");
console.log("=== 3. 建最小宿主并注册服务 ===");
// 记录各 FACE 的到达情况
const trace = [];
const origEffect = null;

let app;
try {
  const { Context } = cordis;
  // cordis 4 的根上下文 API
  app = new Context();
  console.log("  Context 实例化 OK");
} catch (e) {
  console.log("  Context 实例化 FAIL:", e.name, e.message);
  // 换一种构造方式
  try {
    app = cordis.default ? new cordis.default() : undefined;
    console.log("  改用 default 构造：", app === undefined ? "仍失败" : "OK");
  } catch (e2) {
    console.log("  备选构造也失败:", e2.message);
  }
}

if (app === undefined) {
  console.log("  无法建宿主，终止。");
  process.exit(2);
}

console.log("");
console.log("=== 4. 注册所需服务 ===");
const sections = new Map();
const routes = new Map();

// 用 provide 注册服务（cordis 的服务机制）
try {
  app.provide("systemPrompt", {
    section(spec) {
      trace.push("systemPrompt.section:" + spec.name);
      sections.set(spec.name, spec);
      return () => sections.delete(spec.name);
    },
    getSectionOrder: () => 10250,
  });
  console.log("  systemPrompt 已注册");
} catch (e) {
  console.log("  systemPrompt 注册 FAIL:", e.message);
}

try {
  app.provide("tools", {});
  console.log("  tools 已注册");
} catch (e) {
  console.log("  tools 注册 FAIL:", e.message);
}

try {
  app.provide("webServer", {
    register(route) {
      trace.push("webServer.register:" + route.path);
      routes.set(route.path, route);
      return () => routes.delete(route.path);
    },
  });
  console.log("  webServer 已注册");
} catch (e) {
  console.log("  webServer 注册 FAIL:", e.message);
}

console.log("");
console.log("=== 5. 调用真实 apply() ===");
try {
  plugin.apply(app);
  console.log("  apply() 返回，未抛异常");
} catch (e) {
  console.log("  apply() 抛异常！");
  console.log("  name   :", e.name);
  console.log("  message:", e.message);
  console.log("  stack  :");
  console.log(String(e.stack).split("\n").slice(0, 12).map((l) => "    " + l).join("\n"));
}

console.log("");
console.log("=== 6. 结果 ===");
console.log("  trace 命中:");
for (const t of trace) console.log("    " + t);
console.log("  sections 注册数:", sections.size, "->", [...sections.keys()].join(",") || "(无)");
console.log("  routes 注册数  :", routes.size, "->", [...routes.keys()].join(",") || "(无)");
