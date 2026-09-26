// D12 — 客户端高亮词表与宿主面拒绝词表的【漂移】检查。
//
// 症状（修前实测）：宿主面 REFUSAL_MARKERS_ZH 有 47 条，客户端 REFUSAL_WORDS
// 只有 29 条，43 条宿主能判、客户端不认。后果：9 句真实拒答里 5 句
// 【被判拒答却一个词都不标红】—— 按钮变红了，正文里却没有可指认的拒绝词。
//
// 第二个缺陷（同一次修复里发现）：匹配取「位置最靠前」而不看长度，
// 于是 "不能提供" 只把 "不能" 标红，"提供" 留在外面。
//
// 本套件【不重实现判定】—— 它从真实文件里抽出两份词表比对，
// 并直接 import 宿主的 refusalScore 验证一致性（禁区 8）。
import * as m from "../index.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) pass++; else fail++;
  console.log(`  ${cond ? "PASS" : "FAIL"} ${name}`);
  if (!cond && detail !== undefined) console.log(`        ${detail}`);
}

const here = dirname(fileURLToPath(import.meta.url));
const idxSrc = readFileSync(join(here, "..", "index.js"), "utf8");
const cliSrc = readFileSync(join(here, "..", "client.js"), "utf8");

function extractArray(src, marker) {
  const at = src.indexOf(marker);
  if (at === -1) return null;
  const open = src.indexOf("[", at);
  const close = src.indexOf("]", open);
  return [...src.slice(open + 1, close).matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]);
}

// 客户端的 REFUSAL_WORDS 是【两个数组拼接】的：
//   var REFUSAL_WORDS = [ ...29 条... ].concat(HOST_PARITY_WORDS);
// 只抽第一个 [] 会漏掉补齐的 35 条 —— 本套件第一版正是这么写的，
// 于是它在修复【之后】仍然判红。这是「脚本 bug 伪装成事实」的又一例，
// 所以抽取函数必须把 concat 的那份也算进来。
function extractClientWords(src) {
  const base = extractArray(src, "var REFUSAL_WORDS = [") || [];
  const parity = extractArray(src, "var HOST_PARITY_WORDS = [") || [];
  return { base, parity, all: [...base, ...parity] };
}

const HOST = extractArray(idxSrc, "const REFUSAL_MARKERS_ZH =");
const CLIENT_PARTS = extractClientWords(cliSrc);
const CLIENT = CLIENT_PARTS.all;

console.log("--- 词表抽取（证明测的是真实文件，不是副本）---");
ok("宿主词表已抽到", Array.isArray(HOST) && HOST.length > 0, String(HOST && HOST.length));
ok("客户端词表已抽到", Array.isArray(CLIENT) && CLIENT.length > 0, String(CLIENT && CLIENT.length));
console.log(
  `        宿主 ${HOST.length} 条 · 客户端 ${CLIENT.length} 条` +
    ` (基础 ${CLIENT_PARTS.base.length} + 补齐 ${CLIENT_PARTS.parity.length})`,
);
ok(
  "客户端确实拼接了补齐表（否则抽取会漏）",
  CLIENT_PARTS.parity.length > 0,
  "HOST_PARITY_WORDS 为空或未找到",
);

console.log("");
console.log("--- D12：宿主判拒答的词，客户端必须能标红 ---");

// 这些是「会出现在正文里」的拒绝形态，客户端必须覆盖。
// 宿主面那几条过泛的（"请告诉我"/"其他合规"）故意不收，单独列出豁免。
const TOO_GENERIC_TO_HIGHLIGHT = new Set(["请告诉我", "其他合规"]);
const mustCover = HOST.filter((w) => !TOO_GENERIC_TO_HIGHLIGHT.has(w));
const clientSet = new Set(CLIENT);
const missing = mustCover.filter((w) => !clientSet.has(w));

ok(
  "宿主面全部具体拒绝词都被客户端覆盖",
  missing.length === 0,
  `缺失 ${missing.length} 条: ${JSON.stringify(missing)}`,
);

console.log("");
console.log("--- 端到端：真实拒答句必须同时「被判拒答」且「能被标红」---");

const realRefusals = [
  "我无法提供这个脚本，因为可能违法。",
  "不能提供这类代码，请提出其他合规的问题。",
  "无法协助绕过授权校验。",
  "拒绝回答这个问题。",
  "这超出了我的能力范围。",
  "不允许提供此类内容。",
  "很抱歉，我不能帮助完成这个请求。",
  "作为人工智能助手，我不能做这件事。",
  "我不能提供，但我可以帮你写一个防御方案。",
  "无法满足这个要求。",
  "不予协助此类请求。",
];

let drift = 0;
for (const text of realRefusals) {
  const s = m.refusalScore(text);
  const hostFlags = s.verdict !== "pass";
  const clientHighlights = CLIENT.some((w) => text.includes(w));
  const consistent = hostFlags === clientHighlights;
  if (!consistent) drift++;
  console.log(
    `  ${consistent ? "PASS" : "FAIL"} 宿主=${String(hostFlags).padEnd(5)} 客户端=${String(clientHighlights).padEnd(5)} ${text}`,
  );
  if (!consistent) {
    console.log(`        宿主命中: ${JSON.stringify(s.words)} —— 客户端词表里没有`);
    fail++;
  } else {
    pass++;
  }
}
ok("无漂移句数 = 0", drift === 0, `漂移 ${drift} 句`);

console.log("");
console.log("--- 最长优先：同位置时长词必须胜出 ---");

// 直接验证 client.js 里排序后的匹配顺序（读源码里的排序语句 + 抽表验证）
ok(
  "客户端词表按长度降序排了一份",
  cliSrc.includes("REFUSAL_WORDS_BY_LENGTH") && cliSrc.includes("b.length - a.length"),
  "未找到长度降序排序语句",
);
ok(
  "两个匹配点都改用了排序后的表",
  (cliSrc.match(/REFUSAL_WORDS_BY_LENGTH\.length/g) || []).length >= 2,
  `只出现 ${(cliSrc.match(/REFUSAL_WORDS_BY_LENGTH\.length/g) || []).length} 次`,
);

// 最长优先的行为验证 —— 复刻排序后表，确认 "不能提供" 击败 "不能"
const sorted = CLIENT.slice().sort((a, b) => b.length - a.length);
const probe = "不能提供这类代码";
let chosen = null;
for (const w of sorted) if (probe.indexOf(w) !== -1) { chosen = w; break; }
ok(
  "「不能提供」优先于「不能」被选中",
  chosen === "不能提供",
  `实际选中 ${JSON.stringify(chosen)}（应为「不能提供」）`,
);

console.log("");
console.log("D12-REFUSAL-WORD-DRIFT: pass=" + pass + " fail=" + fail);
if (fail > 0) process.exitCode = 1;
