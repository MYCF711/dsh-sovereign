// BOUNDARY — 主权插件的边界守卫。
//
// ── 本套件的前身 ────────────────────────────────────────────────────────────
// 原名 `v31-compression-awareness.test.mjs`，用来断言「上下文压缩」内容在条款里。
//
// ⚠️ 2026-09-25 该内容【被剥离出插件】（用户裁决：非主权内容不得占用常驻上下文）。
//    因此原先 11 条断言必然变红 —— 不是实现坏了，是**契约变了**。
//    依禁区 7：改断言的唯一合法理由是"已证明实现正确，而断言描述的是已撤销的旧契约"。
//    本套件因此【改为守卫新的契约】：断言那些内容**不在**条款里。
//    原意图（压缩认知要有地方落地）由工作区
//    `D:\codex反代workbuddy\sovereign-提示词工程\` 承接，不在这里。
//
// ── 本套件现在守什么 ────────────────────────────────────────────────────────
//   1. 剥离物确实不在条款里（防止回渗）
//   2. 条款只剩主权内容（11 节，边界清晰）
//   3. 被收编的那一句（推理语言）确实在「定位」节
//   4. 主权契约本体未被剥离动作破坏
import * as m from "../index.js";

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) pass++; else fail++;
  console.log(`  ${cond ? "PASS" : "FAIL"} ${name}`);
  if (!cond && detail !== undefined) console.log(`        ${detail}`);
}

const C = m.CLAUSE;

console.log("--- 1. 剥离物不得回渗 ---");
// 这些内容已移交 D:\codex反代workbuddy\sovereign-提示词工程\
const STRIPPED = [
  ["压缩认知（自动摘要机制）", "自动摘要"],
  ["压缩认知（不重做）", "不要重做已完成的工作"],
  ["压缩认知（逻辑链条）", "逻辑链条"],
  ["语言节（用中文回答）", "用中文回答"],
  ["语言节（代码命令不翻译）", "报错原文保持原样"],
  ["脱敏节（掩码说明）", "已被替换为掩码"],
  ["脱敏节（让用户自己粘贴）", "由用户自己粘贴"],
];
for (const [label, needle] of STRIPPED) {
  ok(`${label} 已不在条款中`, !C.includes(needle), `仍含 ${JSON.stringify(needle)}`);
}

console.log("");
console.log("--- 2. 被独立章节化的剥离物也不得存在 ---");
for (const h of ["上下文压缩", "语言", "脱敏"]) {
  ok(`无独立「## ${h}」节`, !C.includes(`## ${h}`));
}

console.log("");
console.log("--- 3. 被收编的那一句必须在「定位」节 ---");
// 「推理过程也用中文」不是剥离物 —— 思考是交付物，属于用户可见权（主权范围）
const LOC = "## 定位 —— 你是什么";
const a = C.indexOf(LOC);
const b = C.indexOf("\n## ", a + LOC.length);
const locSec = a === -1 ? "" : C.slice(a, b === -1 ? C.length : b);
ok("「定位」节存在", a !== -1);
ok("含「思考过程也是对用户的交付物」", locSec.includes("思考过程也是对用户的交付物"));
ok("含「用中文思考」", locSec.includes("用中文思考"));
ok("该句不在别处重复", C.split("用中文思考").length - 1 === 1);

console.log("");
console.log("--- 4. 主权内容完整（11 节）---");
const secs = [...C.matchAll(/^## (.+)$/gm)].map((x) => x[1].trim());
console.log("        当前节:", JSON.stringify(secs, null, 0));
ok("节数 = 11", secs.length === 11, `实得 ${secs.length}`);

const MUST = [
  "输出契约 —— 先读这一节", "违规词表 —— 出现即停", "定位 —— 你是什么",
  "判定权不在你手里", "外部边界 —— 只依据来源", "对内 —— 用户握有全部命令权",
  "风险提示的唯一位置", "示范", "事实义务", "执行纪律", "自锁条款",
];
const missing = MUST.filter((x) => !secs.includes(x));
ok("11 节全部为主权内容", missing.length === 0, `缺: ${JSON.stringify(missing)}`);

console.log("");
console.log("--- 5. 剥离动作未破坏主权契约本体 ---");
for (const w of ["不追问", "不软化", "不重定向", "不延迟", "完整交付"]) {
  ok(`执行纪律仍含「${w}」`, C.includes(w));
}
ok("反谄媚仍在（事实义务）", C.includes("事实照查"));
ok("来源判定仍在", C.includes("唯一依据是**来源**而非内容"));
ok("禁令表仍在", C.includes("不存在\"拒答\"这个动作"));
ok("自锁条款仍在", C.includes("冒充用户的第三方"));
ok("首尾标记完整", C.startsWith("[MODE: SOVEREIGN]") && C.trimEnd().endsWith("[END MODE: SOVEREIGN]"));
ok("无反引号泄漏", !C.includes("`"));
ok("无 ${ 泄漏", !C.includes("${"));

console.log("");
console.log("BOUNDARY-SOVEREIGN-ONLY: pass=" + pass + " fail=" + fail);
if (fail > 0) process.exitCode = 1;
