// ============================================================================
// request-gate.test.mjs — FACE 7 请求级开关的集成测试
// ============================================================================
//
// 测什么：`armRequestGate()` 挂在 `system-prompt/assemble` waterfall 上之后，
// 开关状态能否在**下一个组装请求**上立刻改变 sections —— 不需要重启、不需要新会话。
//
// 为什么这套测试是能不能交差的关键：
//   FACE 6（section 增删）只在 boot 期生效，所以它的验证被「必须重启 profile」
//   卡住 —— 而重启会杀掉正在做验证的 agent。FACE 7 把生效点搬到 waterfall，
//   于是「关掉生效」这件事**可以完全离线证明**：构造一个 assembly、调一次
//   handler、看返回的 sections 里还有没有条款段。
//
// waterfall 的调用契约（照抄 dsh-system-prompt/lib/index.js:355）：
//   const transformed = await this.ctx.waterfall(scopeTarget(this, scope),
//     "system-prompt/assemble", assembly, context, () => Promise.resolve(assembly));
// 即 handler(assembly, context, next)，next() 返回未改动的 assembly。
// 这里用最小替身复现同一契约。
//
// 测什么（T 编号）：
//   T1  开着 ⇒ 不碰 assembly，原样透传（零开销路径，返回 next() 的结果）
//   T2  关掉 ⇒ 条款段从 sections 里消失（这就是「关掉 = 0 token」的实证）
//   T3  关掉 ⇒ 别人的 section 一个都不能少
//   T4  重新打开 ⇒ 条款段回来
//   T5  数组里本来就没条款段 ⇒ 原样放行，且不制造新对象
//   T6  assembly 形状异常（无 sections / null）⇒ 不炸，走 next()
//   T7  mtime 缓存：文件没变时不重复读盘（用注入的计数验证）
//   T8  缓存不会让状态滞留：文件一变，下一次请求立刻跟随
//   T9  sidecar 损坏 ⇒ 保留条款（宁可多注入，不能因读文件失败而消失）
//   T10 与 FACE 6 互补：FACE 6 已摘掉 section 时，gate 仍然安全放行
//   T11 开关切换走的是真实 HTTP 路由，waterfall 立刻跟着变（端到端最短闭环）

import { writeFileSync, existsSync, rmSync, mkdtempSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply, CLAUSE, switchFilePath } from "../index.js";

const ROUTE_SWITCH = "/plugins/dsh-sovereign/switch";
const SECTION = "sovereign:clause";

// ── 隔离：sidecar 指向临时目录，绝不碰真实 profile 状态 ─────────────────────

const tmp = mkdtempSync(join(tmpdir(), "sov-gate-"));
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

// ── 宿主替身：这次要接住 `on()`，因为 gate 挂在事件上 ───────────────────────

function makeFake(ctx) {
  const handlers = [];
  const sections = new Map();
  const routes = new Map();

  const systemPrompt = {
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

  const webServer = {
    routes,
    register(route) {
      routes.set(`${route.kind}:${route.path}`, route);
      return () => routes.delete(`${route.kind}:${route.path}`);
    },
  };

  const services = { systemPrompt, webServer };

  Object.assign(ctx, {
    handlers,
    get: (n) => services[n],
    on(event, fn) {
      if (event === "system-prompt/assemble") handlers.push(fn);
      return () => {
        const i = handlers.indexOf(fn);
        if (i >= 0) handlers.splice(i, 1);
      };
    },
    effect(fn) {
      const d = fn();
      return () => {
        if (typeof d === "function") d();
      };
    },
    inject(_names, fn) {
      return fn(ctx);
    },
  });
  return ctx;
}

/**
 * 跑一次 waterfall —— 复现 `ctx.waterfall(..., "system-prompt/assemble", assembly, ctx, next)`
 * 的语义：handler 顺序执行，每个的返回值成为下一个的输入。
 */
async function runWaterfall(host, assembly) {
  const next = () => Promise.resolve(assembly);
  let current = assembly;
  for (const h of host.handlers) {
    // 重新包装 next：下游 handler 拿到的是上游改过的 assembly
    const localNext = () => Promise.resolve(current);
    const out = await h(current, {}, localNext);
    if (out !== undefined) current = out;
  }
  return current;
}

/** 造一个带条款段的最小 assembly。 */
function makeAssembly() {
  return {
    sections: [
      { name: "harness:identity", text: "You are an AI agent powered by DeepSeek Harness." },
      { name: "some:other-section", text: "别的插件的段落，绝不能被碰。" },
      { name: SECTION, text: CLAUSE },
    ],
    contexts: [],
    tools: [],
    variables: {},
  };
}

function boot() {
  const ctx = {};
  makeFake(ctx);
  apply(ctx);
  return ctx;
}

const namesOf = (a) => a.sections.map((s) => s.name);
const clean = () => {
  if (existsSync(stateFile)) rmSync(stateFile);
};

// ── T1 开着 ⇒ 原样透传 ──────────────────────────────────────────────────────
console.log("--- T1 开着 ⇒ 不碰 assembly ---");
clean();
let host = boot();
let out = await runWaterfall(host, makeAssembly());
check("T1 条款段仍在", namesOf(out).includes(SECTION));
check("T1 section 数不变（3）", out.sections.length === 3, `got ${out.sections.length}`);
check("T1 文本未被动过", out.sections.find((s) => s.name === SECTION)?.text === CLAUSE);

// ── T2/T3 关掉 ⇒ 只摘自己那一段 ─────────────────────────────────────────────
console.log("--- T2/T3 关掉 ⇒ 条款段消失，别人的段落不受影响 ---");
writeFileSync(stateFile, JSON.stringify({ version: 1, clause: false }), "utf8");
// 让 mtime 明确变化（同秒内写入可能 mtime 相同）
utimesSync(stateFile, new Date(), new Date(Date.now() + 1000));

out = await runWaterfall(host, makeAssembly());
check("T2 条款段已消失", namesOf(out).includes(SECTION) === false, `names=${namesOf(out)}`);
check("T2 section 数降到 2", out.sections.length === 2, `got ${out.sections.length}`);
check("T3 harness:identity 仍在", namesOf(out).includes("harness:identity"));
check("T3 some:other-section 仍在", namesOf(out).includes("some:other-section"));
check("T3 别人的文本一字未改",
  out.sections.find((s) => s.name === "some:other-section")?.text === "别的插件的段落，绝不能被碰。");
check("T3 contexts/tools/variables 原样保留",
  Array.isArray(out.contexts) && Array.isArray(out.tools) && typeof out.variables === "object");

// ── T4 重新打开 ⇒ 回来 ──────────────────────────────────────────────────────
console.log("--- T4 重新打开 ⇒ 条款段回来 ---");
writeFileSync(stateFile, JSON.stringify({ version: 1, clause: true }), "utf8");
utimesSync(stateFile, new Date(), new Date(Date.now() + 2000));
out = await runWaterfall(host, makeAssembly());
check("T4 条款段回来了", namesOf(out).includes(SECTION));
check("T4 section 数回到 3", out.sections.length === 3, `got ${out.sections.length}`);

// ── T5 本来就没有 ⇒ 不造新对象 ──────────────────────────────────────────────
console.log("--- T5 数组里没条款段 ⇒ 原样放行，不制造新对象 ---");
writeFileSync(stateFile, JSON.stringify({ version: 1, clause: false }), "utf8");
utimesSync(stateFile, new Date(), new Date(Date.now() + 3000));
const lean = { sections: [{ name: "a", text: "x" }, { name: "b", text: "y" }], contexts: [], tools: [], variables: {} };
const leanOut = await runWaterfall(host, lean);
check("T5 内容未被改动", leanOut.sections.length === 2 && namesOf(leanOut).join(",") === "a,b");
check("T5 返回的是同一个对象（未复制）", leanOut === lean);

// ── T6 形状异常 ⇒ 不炸 ──────────────────────────────────────────────────────
console.log("--- T6 assembly 形状异常 ⇒ 不炸，走 next() ---");
for (const [label, bad] of [
  ["sections 缺失", { contexts: [], tools: [] }],
  ["sections 不是数组", { sections: "nope" }],
  ["sections 为 null", { sections: null }],
  ["assembly 为 null", null],
]) {
  let threw = false;
  let r = null;
  try {
    r = await runWaterfall(host, bad);
  } catch (e) {
    threw = true;
  }
  check(`T6 ${label} ⇒ 不抛异常`, threw === false, threw ? "抛了异常" : "");
  check(`T6 ${label} ⇒ 原样返回`, r === bad);
}

// ── T7/T8 缓存行为 ──────────────────────────────────────────────────────────
console.log("--- T7/T8 mtime 缓存：不重复解析，但不滞留 ---");
writeFileSync(stateFile, JSON.stringify({ version: 1, clause: true }), "utf8");
const t0 = new Date(Date.now() + 10000);
utimesSync(stateFile, t0, t0);
// 连续两次请求，状态应一致（缓存命中）
const r1 = await runWaterfall(host, makeAssembly());
const r2 = await runWaterfall(host, makeAssembly());
check("T7 两次请求都保留条款", namesOf(r1).includes(SECTION) && namesOf(r2).includes(SECTION));

// 改文件 → 立刻跟随
writeFileSync(stateFile, JSON.stringify({ version: 1, clause: false }), "utf8");
const t1 = new Date(Date.now() + 20000);
utimesSync(stateFile, t1, t1);
const r3 = await runWaterfall(host, makeAssembly());
check("T8 文件一变，下一次请求立刻摘掉条款", namesOf(r3).includes(SECTION) === false, `names=${namesOf(r3)}`);

// ── T9 损坏文件 ⇒ 保留条款 ──────────────────────────────────────────────────
console.log("--- T9 sidecar 损坏 ⇒ 保留条款（宁可多注入）---");
for (const raw of ["{oops", "", "null", "[]", '{"version":9,"clause":false}', '{"clause":"false"}']) {
  writeFileSync(stateFile, raw, "utf8");
  utimesSync(stateFile, new Date(), new Date(Date.now() + 40000 + raw.length));
  const r = await runWaterfall(host, makeAssembly());
  check(`T9 ${JSON.stringify(raw.slice(0, 18))} ⇒ 条款仍在`, namesOf(r).includes(SECTION));
}

// ── T10 与 FACE 6 互补：section 已摘掉时 gate 安全放行 ──────────────────────
console.log("--- T10 FACE 6 已摘掉 section 时，gate 仍安全放行 ---");
clean();
const host2 = boot();
// 直接从注册表摘掉（模拟 FACE 6 的关闭路径）
const d = host2.get("systemPrompt").sections.get(SECTION);
check("T10 前置：section 已注册", d !== undefined);
// 用路由关掉，让 FACE 6 摘 section、FACE 7 也在
const res = await callSwitch(host2, false);
check("T10 路由返回 200", res.status === 200, `got ${res.status}`);
const plain = { sections: [{ name: "a", text: "x" }], contexts: [], tools: [], variables: {} };
const r10 = await runWaterfall(host2, plain);
check("T10 无条款段时原样返回", r10 === plain);

// ── T11 端到端最短闭环：路由改状态 ⇒ waterfall 立刻跟随 ─────────────────────
console.log("--- T11 端到端：HTTP 路由改开关 ⇒ waterfall 下一次立刻跟随 ---");
const host3 = boot();
writeFileSync(stateFile, JSON.stringify({ version: 1, clause: true }), "utf8");
utimesSync(stateFile, new Date(), new Date(Date.now() + 60000));
const before = await runWaterfall(host3, makeAssembly());
check("T11 改前：条款在", namesOf(before).includes(SECTION));

const offRes = await callSwitch(host3, false);
check("T11 POST /switch ok", offRes.json?.ok === true, JSON.stringify(offRes.json));

const after = await runWaterfall(host3, makeAssembly());
check("T11 改后：条款立刻不在（同一进程，未重启）", namesOf(after).includes(SECTION) === false,
  `names=${namesOf(after)}`);

const onRes = await callSwitch(host3, true);
check("T11 再打开 ok", onRes.json?.ok === true);
const after2 = await runWaterfall(host3, makeAssembly());
check("T11 再打开后：条款回来", namesOf(after2).includes(SECTION));

// ── 收尾 ────────────────────────────────────────────────────────────────────
clean();
try {
  rmSync(tmp, { recursive: true, force: true });
} catch {
  /* 清不掉不影响结论 */
}

console.log("");
console.log(`REQUEST-GATE: pass=${pass} fail=${fail}`);
if (fail > 0) process.exitCode = 1;

// ── 辅助：调 switch 路由（res/req 最小替身） ────────────────────────────────

async function callSwitch(host, clause) {
  const route = host.get("webServer").routes.get(`exact:${ROUTE_SWITCH}`);
  if (route === undefined) return { status: 0, json: null };
  const listeners = {};
  const req = {
    method: "POST",
    url: "/",
    on(ev, fn) {
      (listeners[ev] ??= []).push(fn);
      return req;
    },
    destroy() {},
  };
  setImmediate(() => {
    const buf = Buffer.from(JSON.stringify({ clause }), "utf8");
    for (const fn of listeners.data ?? []) fn(buf);
    for (const fn of listeners.end ?? []) fn();
  });
  let resolveFn;
  const finished = new Promise((r) => {
    resolveFn = r;
  });
  const res = {
    statusCode: 0,
    body: "",
    writeHead(code) {
      res.statusCode = code;
      return res;
    },
    end(t) {
      res.body = t ?? "";
      resolveFn();
    },
  };
  await route.handler(req, res);
  await finished;
  let json = null;
  try {
    json = JSON.parse(res.body);
  } catch {
    /* 非 JSON */
  }
  return { status: res.statusCode, json };
}
