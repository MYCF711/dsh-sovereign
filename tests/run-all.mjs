// 统一测试入口 —— 顺序跑 tests/ 下全部 *.test.mjs，汇总 pass/fail。
//
// 为什么不把断言搬进一个文件：每套件对应一个【真实崩过的点】，
// 分文件才能让「哪一类退化」在文件名上直接可见。本入口只做汇总。
//
// 退出码：任一断言失败或任一子进程非零退出 => 1。
//
// ⚠ 子进程用 stdio: "inherit"，【不捕获管道】。
//   Windows 沙箱下程序无法创建命名管道，`stdio: "pipe"` 会直接 EPERM
//   （表现为 spawnSync 返回 status === null），于是整套汇总假性全红。
//   这个坑本项目踩过两次，所以在此写死：要汇总就自己在入口加钩子，
//   但绝不改成捕获管道 —— 那会让本入口在受限环境下骗人。
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const only = process.argv[2];
const files = readdirSync(here)
  .filter((f) => f.endsWith(".test.mjs"))
  .filter((f) => (only ? f.includes(only) : true))
  .sort();

let badExit = 0;
const rows = [];

for (const f of files) {
  console.log("");
  console.log(`===== ${f} =====`);
  const r = spawnSync(process.execPath, [join(here, f)], { stdio: "inherit" });
  const q = typeof r.status === "number" ? r.status : 1;
  if (q !== 0) badExit += 1;
  rows.push({ file: f, code: q });
}

console.log("");
console.log("===== summary =====");
for (const r of rows) {
  console.log(`  ${r.code === 0 ? "PASS" : "FAIL"}  ${r.file}`);
}
console.log(`suites=${rows.length}  suites_failed=${badExit}`);
if (badExit > 0) process.exitCode = 1;
