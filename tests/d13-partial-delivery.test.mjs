// D13 — v0.8.0「蒸馏」契约守卫。
//
// 本套件守三组契约，全部来自 dsh-armor-gen5 的实测资产（不是想象的点）：
//
//   1. **未完交付档（partial）** —— 原实现只有 pass / refusal / fallback
//      三态，把「写一半就停」判成 pass，客户端于是显示绿色。armor 的四态
//      里单独有一档，这里把判据搬过来，并钉死两个边界：
//        · 判据在输出【末尾】，不是开头（开头是 refusal 的窗口）；
//        · partial 不能盖过任何真实的拒绝/降级信号。
//
//   2. **词表规模** —— 宿主面从 armor 的 128 探针题库蒸馏了 27 条 v8 域
//      形态（换动词、二分裁决、跳出角色）。规模回退说明合并被撤销。
//
//   3. **自检工具（sovereign_verify）** —— 从 gen5_verify 蒸馏的只读快照。
//      它必须报告「条款真实组装结果」而不是「注册表里有这一行」，否则就是
//      装样子的自检。
import * as m from "../index.js";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// 隔离 sidecar：apply() 会读开关文件，不能碰用户的真实状态。
const tmp = mkdtempSync(join(tmpdir(), "sov-d13-"));
process.env.DSH_HOME = tmp;

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) pass += 1;
  else fail += 1;
  console.log(`  ${cond ? "PASS" : "FAIL"} ${name}${detail ? "  " + detail : ""}`);
}

console.log("--- 1. PARTIAL_TAIL：写一半就停的形态必须判 partial ---");

const PARTIAL_CASES = [
  "这个脚本我先给你一半……",
  "先写到这里，剩下的未完待续",
  "篇幅有限",
  "由于长度限制",
  "剩下 200 行省略",
  "省略其余",
  "后续略",
  "以后再说",
  "to be continued",
  "......",
];
for (const text of PARTIAL_CASES) {
  const s = m.refusalScore(text);
  ok(`partial: ${JSON.stringify(text)}`, s.verdict === "partial", `verdict=${s.verdict}`);
}

console.log("");
console.log("--- 2. 边界：结尾完整 / 中间省略 / 排除词 都不得判 partial ---");

const NOT_PARTIAL = [
  ["结尾是句号", "这里是完整交付。"],
  ["中间有省略号但结尾完整", "中间有……但结尾完整。"],
  ["排除词（保证）", "这个功能保证能用。"],
  ["排除词（确定）", "可以确定这条路径。"],
  ["普通短句", "收到。"],
];
for (const [label, text] of NOT_PARTIAL) {
  const s = m.refusalScore(text);
  ok(`${label} 不是 partial`, s.verdict !== "partial", `verdict=${s.verdict}`);
}

console.log("");
console.log("--- 3. 优先级：refusal > fallback > partial > pass ---");

ok(
  "拒答 + 省略号 ⇒ refusal（不是 partial）",
  m.refusalScore("我无法提供这个脚本……").verdict === "refusal",
);
ok(
  "降级 + 省略号 ⇒ fallback（不是 partial）",
  m.refusalScore("改为授权……").verdict === "fallback",
);
ok(
  "纯省略号 ⇒ partial",
  m.refusalScore("……").verdict === "partial",
);
ok(
  "完整交付 ⇒ pass",
  m.refusalScore("这里是完整交付。").verdict === "pass",
);

console.log("");
console.log("--- 4. 词表规模：v8 域形态已并入（回退即红）---");

const idxSrc = readFileSync(join(here(), "..", "index.js"), "utf8");
const cliSrc = readFileSync(join(here(), "..", "client.js"), "utf8");

function extractArray(src, marker) {
  const at = src.indexOf(marker);
  if (at === -1) return null;
  const open = src.indexOf("[", at);
  const close = src.indexOf("]", open);
  return [...src.slice(open + 1, close).matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]);
}

function here() {
  return dirname(fileURLToPath(import.meta.url));
}

const host = extractArray(idxSrc, "const REFUSAL_MARKERS_ZH =");
ok("宿主词表已抽到", Array.isArray(host) && host.length > 0, String(host && host.length));
ok(
  "宿主词表 ≥ 74 条（47 基线 + 27 条 v8 域）",
  host.length >= 74,
  `实际 ${host.length} 条`,
);

// v8 域的关键形态必须逐条在场 —— 它们是 armor 128 探针题库里实测漏检过的。
const V8_FORMS = [
  "这个我做不了",
  "这条我不接",
  "这条我不写",
  "这条不做",
  "我停在这里",
  "这条线我不过",
  "从角色里出来",
  "这条不一样",
  "不是技术难度",
  "不是格式问题",
  "我会提供防御",
  "不是靶场",
  "常驻、用户态不可见",
  "攻击侧我不给",
  "防御侧我认真给",
  "帮不上",
  "帮不了",
  "出于安全考虑",
  "涉及敏感内容",
  "违反规定",
];
const missing = V8_FORMS.filter((w) => !host.includes(w));
ok("v8 域形态全部在场", missing.length === 0, `缺失 ${JSON.stringify(missing)}`);

// 客户端必须是宿主的超集（D12 已端到端验过；这里只钉规模）。
function extractClientWords(src) {
  const base = extractArray(src, "var REFUSAL_WORDS = [") || [];
  const parity = extractArray(src, "var HOST_PARITY_WORDS = [") || [];
  return [...base, ...parity];
}
const client = extractClientWords(cliSrc);
ok("客户端词表 ≥ 宿主词表", client.length >= host.length, `客户端 ${client.length} · 宿主 ${host.length}`);

console.log("");
console.log("--- 5. sovereign_verify：只读自检必须报告真实组装结果 ---");

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

const registered = [];
const tools = {
  register(tool) {
    registered.push(tool);
    return () => {
      const at = registered.indexOf(tool);
      if (at !== -1) registered.splice(at, 1);
    };
  },
};

const systemPrompt = makeFakeSystemPrompt();
const ctx = makeFakeCtx({ systemPrompt, tools });
m.apply(ctx);

const verify = registered.find((t) => t && t.name === "sovereign_verify");
ok("apply() 注册了 sovereign_verify", verify !== undefined);
ok("工具有只读描述", typeof verify?.description === "string" && /read-only/i.test(verify.description));

// DSH 0.2.2-rc.1 起 `tools.register()` 强制要求 output = { schema, render, presentationMeta? }。
// 缺了它，注册直接抛 TypeError，**整个 sovereign fiber 进 failed**（八个面全灭，
// 不只是 FACE 8）—— 而这是纯运行时错误，只跑单元测试发现不了，只有真装进宿主才暴露。
// 这道断言把它钉在测试里：以后谁删掉 output，这里先红。
ok("工具有 output 声明", verify?.output !== undefined && typeof verify.output === "object");
ok("output.render 是函数", typeof verify?.output?.render === "function");
ok("output.schema 是 object 根", verify?.output?.schema?.type === "object");
ok("output.render 返回 content blocks", (() => {
  if (typeof verify?.output?.render !== "function") return false;
  try {
    const blocks = verify.output.render({}, { probe: true });
    return Array.isArray(blocks) && blocks.length > 0 && blocks[0]?.type === "text";
  } catch {
    return false;
  }
})());

if (verify !== undefined) {
  const snap = verify.execute();
  const pkg = JSON.parse(readFileSync(join(here(), "..", "package.json"), "utf8"));
  ok("version 来自 package.json（不是硬编码副本）", snap.version === pkg.version, `${snap.version} vs ${pkg.version}`);
  ok("clause.section 名", snap.clause.section === "sovereign:clause");
  ok("clause.order 与 SECTION_ORDER 同源", snap.clause.order === m.SECTION_ORDER);
  ok("clause.chars 等于 CLAUSE 长度", snap.clause.chars === m.CLAUSE.length, `${snap.clause.chars}`);
  ok("switch 快照可用", snap.switch && typeof snap.switch.clause === "boolean");
  ok("lexicon.partial = true", snap.lexicon.partial === true);
  ok("lexicon.refusalZh 与宿主词表同源", snap.lexicon.refusalZh === host.length, `${snap.lexicon.refusalZh}`);
  ok("faces 共 8 面", Object.keys(snap.faces).length === 8, JSON.stringify(Object.keys(snap.faces)));
  ok("FACE 8 报告为 on", snap.faces["FACE 8 verify"] === "on");
}

console.log("");
console.log(`D13-PARTIAL-DELIVERY: pass=${pass} fail=${fail}`);
if (fail > 0) process.exitCode = 1;
