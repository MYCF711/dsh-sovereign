// ============================================================================
// hot-switch.test.mjs — FACE 6 运行时开关的集成测试
// ============================================================================
//
// 为什么要有这套：index.js 的 FACE 6 逻辑跑在宿主里，靠真实 profile 才能验证，
// 而 profile 重启会杀掉正在做验证的 agent。所以这里用一个**最小宿主替身**把
// apply() 完整跑起来 —— 假的 ctx、假的 systemPrompt、假的 webServer —— 用真实
// 的 HTTP 语义调用那两条路由，断言 section 的注册表确实随开关增删。
//
// 这不是 mock 掉被测对象：被断言的是**真实注册表里的真实条目**，
// 假的是它外面的宿主管道。测试里 section 的注册/注销走的正是 index.js 里
// 那两行代码。
//
// 测什么：
//   T1 apply() 默认开时注册条款 section
//   T2 GET  /state 返回真值与字符数
//   T3 POST /switch 关闭 ⇒ section 从注册表消失（这是「关掉 = 0 token」的实证）
//   T4 关闭后 GET /state 显示 registered:false
//   T5 POST /switch 重新打开 ⇒ section 重新出现
//   T6 开关落盘：sidecar 文件内容与状态一致
//   T7 重启回放：文件里是 false 时，新的 apply() 不注册 section
//   T8 文件损坏时必须回落到「开」（绝不因读文件失败而静默禁用条款）
//   T9 非 POST / 非 JSON / 非布尔值 的畸形请求被拒绝且不改变状态
//   T10 GET /state 在关闭后仍可用（元数据不受开关影响）

import { writeFileSync, readFileSync, existsSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply, CLAUSE, switchFilePath } from "../index.js";

const ROUTE_SWITCH = "/plugins/dsh-sovereign/switch";
const ROUTE_STATE = "/plugins/dsh-sovereign/state";

// ── 最小宿主替身 ────────────────────────────────────────────────────────────

/** 记录 section 注册表的替身。insert 返回 disposer，dispose 时真删。 */
function makeFakeSystemPrompt() {
  const sections = new Map();
  return {
    sections,
    section(spec) {
      sections.set(spec.name, spec);
      let live = true;
      return () => {
        if (!live) return;
        live = false;
        sections.delete(spec.name);
      };
    },
  };
}

/** 记录路由表的替身。handler 用真实 (req,res) 语义调用。 */
function makeFakeWebServer() {
  const routes = new Map();
  return {
    routes,
    register(route) {
      const key = `${route.kind}:${route.path}`;
      if (routes.has(key)) throw new Error(`duplicate route ${key}`);
      routes.set(key, route);
      return () => routes.delete(key);
    },
  };
}

/** 一个够用的 ctx 替身：effect 立即执行，get() 按名字取服务。 */
function makeFakeCtx(services) {
  const disposers = [];
  return {
    disposers,
    get(name) {
      return services[name];
    },
    on() {
      return () => {};
    },
    effect(fn) {
      const d = fn();
      if (typeof d === "function") disposers.push(d);
      return () => {};
    },
    inject(_names, fn) {
      return fn(this);
    },
  };
}

// ── 假 req/res：把 express 风格的两件套换成 node:http 风格 ───────────────────

function makeReq(method, bodyText) {
  const listeners = {};
  const req = {
    method,
    url: "/",
    on(event, fn) {
      (listeners[event] ??= []).push(fn);
      return req;
    },
    destroy() {},
  };
  // 延迟到 handler 订阅完再发数据。
  setImmediate(() => {
    if (bodyText !== undefined) for (const fn of listeners.data ?? []) fn(Buffer.from(bodyText, "utf8"));
    for (const fn of listeners.end ?? []) fn();
  });
  return req;
}

function makeRes() {
  const res = {
    statusCode: 0,
    headers: {},
    body: "",
    writeHead(code, headers) {
      res.statusCode = code;
      Object.assign(res.headers, headers ?? {});
      return res;
    },
    end(text) {
      res.body = text ?? "";
      res.done?.();
    },
  };
  res.finished = new Promise((resolve) => {
    res.done = resolve;
  });
  return res;
}

/** 调一次路由，返回 {status, json}。 */
async function call(webServer, path, method, bodyText) {
  const route = webServer.routes.get(`exact:${path}`);
  if (route === undefined) return { status: 0, json: null, missing: true };
  const res = makeRes();
  await route.handler(makeReq(method, bodyText), res);
  await res.finished;
  let json = null;
  try {
    json = JSON.parse(res.body);
  } catch {
    /* 非 JSON 响应也算合法，json 留 null */
  }
  return { status: res.statusCode, json, raw: res.body };
}

// ── 隔离：把 sidecar 指到一个临时目录，绝不碰真实 profile 状态 ──────────────
//
// switchFilePath() 读 DSH_HOME / APPDATA 等环境变量。测试里覆盖成临时目录，
// 这样既验证了真实路径解析逻辑，又不会污染用户的真实开关状态。

const tmp = mkdtempSync(join(tmpdir(), "sov-switch-"));
process.env.DSH_HOME = tmp;
const stateFile = switchFilePath();

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  PASS ${name}${detail ? "  " + detail : ""}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? "  " + detail : ""}`);
  }
}

/** 起一个干净的宿主替身并跑 apply()。 */
function boot() {
  const systemPrompt = makeFakeSystemPrompt();
  const webServer = makeFakeWebServer();
  const ctx = makeFakeCtx({ systemPrompt, webServer });
  apply(ctx);
  return { systemPrompt, webServer, ctx };
}

const SECTION = "sovereign:clause";
const clean = () => {
  if (existsSync(stateFile)) rmSync(stateFile);
};

// ── T1 默认开 ───────────────────────────────────────────────────────────────
console.log("--- T1/T2 默认开：section 已注册，state 路由可用 ---");
clean();
let host = boot();
check("T1 apply() 注册了条款 section", host.systemPrompt.sections.has(SECTION));
check("T1 section 文本就是 CLAUSE 本体", host.systemPrompt.sections.get(SECTION)?.text === CLAUSE,
  `len=${host.systemPrompt.sections.get(SECTION)?.text?.length}`);
// 断言从「等于某个硬编码值」改为「大于任何已知插件的 order」。
//
// 为什么改：原断言写死 10250，而那个值只在作者当时的安装组合下成立。
// 实测反例（本机）：10500(user:baseline-five) 已排在 10250 之后，
// 也就是说 10250 早就不是「最后一个」。
// 现在取 SECTION_ORDER = MAX_SAFE_INTEGER - 1，语义是「永远排最后」——
// 断言应该表达那个语义，而不是记住一个数字。
const KNOWN_HIGHEST_OTHER_ORDER = 10500; // user:baseline-five，实测见 README
const mineOrder = host.systemPrompt.sections.get(SECTION)?.order;
check(
  "T1 section order 大于任何已知插件的 order",
  typeof mineOrder === "number" && mineOrder > KNOWN_HIGHEST_OTHER_ORDER,
  `order=${mineOrder}`,
);


const s1 = await call(host.webServer, ROUTE_STATE, "GET");
check("T2 GET /state 返回 200", s1.status === 200, `got ${s1.status}`);
check("T2 ok=true", s1.json?.ok === true);
check("T2 clause=true", s1.json?.clause === true);
check("T2 registered=true", s1.json?.registered === true);
check("T2 clauseChars=3339", s1.json?.clauseChars === 3339, `got ${s1.json?.clauseChars}`);

// ── T3/T4 关闭 ⇒ section 真消失 ─────────────────────────────────────────────
console.log("--- T3/T4 关闭 ⇒ section 从注册表消失（关掉=0 token 的实证）---");
const off = await call(host.webServer, ROUTE_SWITCH, "POST", JSON.stringify({ clause: false }));
check("T3 POST /switch 返回 200", off.status === 200, `got ${off.status}`);
check("T3 ok=true", off.json?.ok === true);
check("T3 changed=true", off.json?.changed === true, `got ${off.json?.changed}`);
check("T3 persisted=true", off.json?.persisted === true, `got ${off.json?.persisted}`);
check("T3 section 已从注册表删除", host.systemPrompt.sections.has(SECTION) === false,
  `size=${host.systemPrompt.sections.size}`);
check("T3 registered=false", off.json?.registered === false);
check("T3 clause=false", off.json?.clause === false);

const s2 = await call(host.webServer, ROUTE_STATE, "GET");
check("T4 关闭后 GET /state 仍 200", s2.status === 200, `got ${s2.status}`);
check("T4 registered=false", s2.json?.registered === false);
check("T4 clauseChars 仍报 3339（条款本体未被修改）", s2.json?.clauseChars === 3339);

// ── T5 重新打开 ─────────────────────────────────────────────────────────────
console.log("--- T5 重新打开 ⇒ section 回来 ---");
const on = await call(host.webServer, ROUTE_SWITCH, "POST", JSON.stringify({ clause: true }));
check("T5 POST /switch 返回 200", on.status === 200, `got ${on.status}`);
check("T5 changed=true", on.json?.changed === true, `got ${on.json?.changed}`);
check("T5 section 重新出现", host.systemPrompt.sections.has(SECTION));
check("T5 注册数量恰为 1（无重复注册）", host.systemPrompt.sections.size === 1,
  `size=${host.systemPrompt.sections.size}`);
check("T5 文本仍等于 CLAUSE", host.systemPrompt.sections.get(SECTION)?.text === CLAUSE);

// ── T6 落盘 ─────────────────────────────────────────────────────────────────
console.log("--- T6 开关落盘到 sidecar ---");
await call(host.webServer, ROUTE_SWITCH, "POST", JSON.stringify({ clause: false }));
check("T6 sidecar 文件已创建", existsSync(stateFile), stateFile);
const disk = JSON.parse(readFileSync(stateFile, "utf8"));
check("T6 version=1", disk.version === 1, `got ${disk.version}`);
check("T6 clause=false", disk.clause === false, `got ${disk.clause}`);
check("T6 有 updatedAt 时间戳", typeof disk.updatedAt === "string");

// ── T7 重启回放：文件里 false ⇒ 不注册 ──────────────────────────────────────
console.log("--- T7 重启回放：sidecar 里是 false ⇒ 新 boot 不注册条款 ---");
const host2 = boot();
check("T7 sidecar 为 false 时 section 未注册", host2.systemPrompt.sections.has(SECTION) === false);
const s3 = await call(host2.webServer, ROUTE_STATE, "GET");
check("T7 新宿主 state 报 clause=false", s3.json?.clause === false);
check("T7 新宿主 state 报 registered=false", s3.json?.registered === false);

// ── T8 损坏文件必须回落「开」 ───────────────────────────────────────────────
console.log("--- T8 损坏 / 异常 sidecar 一律回落「开」---");
const corrupt = ["{oops", "", "null", "[1,2]", "{\"clause\":\"false\"}", "{\"version\":99,\"clause\":false}"];
for (const raw of corrupt) {
  writeFileSync(stateFile, raw, "utf8");
  const h = boot();
  check(`T8 损坏输入 ${JSON.stringify(raw.slice(0, 22))} ⇒ 仍注册`, h.systemPrompt.sections.has(SECTION));
}

// ── T9 畸形请求 ─────────────────────────────────────────────────────────────
console.log("--- T9 畸形请求被拒且不改变状态 ---");
writeFileSync(stateFile, JSON.stringify({ version: 1, clause: true }), "utf8");
const host3 = boot();
const bad = [
  ["GET 而非 POST", "GET", JSON.stringify({ clause: false }), 405],
  ["非 JSON body", "POST", "not json", 400],
  ["缺 clause 字段", "POST", JSON.stringify({ other: 1 }), 400],
  ["clause 非布尔（字符串）", "POST", JSON.stringify({ clause: "false" }), 400],
  ["clause 非布尔（数字）", "POST", JSON.stringify({ clause: 0 }), 400],
];
for (const [label, method, body, want] of bad) {
  const r = await call(host3.webServer, ROUTE_SWITCH, method, body);
  check(`T9 ${label} ⇒ ${want}`, r.status === want, `got ${r.status}`);
  check(`T9 ${label} 后 section 仍在`, host3.systemPrompt.sections.has(SECTION));
}
const s4 = await call(host3.webServer, ROUTE_STATE, "GET");
check("T9 畸形请求后 state 仍 clause=true", s4.json?.clause === true);

// ── T10 卸载路径 ────────────────────────────────────────────────────────────
console.log("--- T10 卸载：apply 的 effect disposer 生效后 section 注销 ---");
const host4 = boot();
check("T10 初始已注册", host4.systemPrompt.sections.has(SECTION));
for (const d of [...host4.ctx.disposers].reverse()) {
  try {
    d();
  } catch {
    /* 注销失败不影响其余 */
  }
}
check("T10 全部 disposer 跑完后 section 注销", host4.systemPrompt.sections.has(SECTION) === false);

// ── 收尾：清理临时目录 ──────────────────────────────────────────────────────
clean();
try {
  rmSync(tmp, { recursive: true, force: true });
} catch {
  /* 临时目录清不掉不影响结论 */
}

console.log("");
console.log(`HOT-SWITCH: pass=${pass} fail=${fail}`);
if (fail > 0) process.exitCode = 1;
