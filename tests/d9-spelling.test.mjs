// D9 — SPELLING EQUIVALENCE. The same destination written differently.
//
// Why this file exists (measured 2026-09-24):
//   After D8 closed the drive-root spellings, an agent-generated review listed ten
//   more bypass directions. Fifteen of them reached protected destinations while
//   every table missed them — each wrote the path in a shape the raw regexes
//   cannot see. D9 normalizes the candidate before the tables look.
//
// The lesson this suite pins: a guard that matches SPELLINGS will always be one
// spelling behind. Normalize the destination, then judge it.
//
// Both directions are pinned, in the shape `adversarial.test.mjs` established:
//   · the variant must reach the same DENY as its canonical form;
//   · and the tightening must NOT reach the ordinary paths the backstop allows —
//     a rule that also refuses `rm -rf ./build` is worse than the gap it closed.
import * as m from "../index.js";

const T = (command) => ({ name: "pwsh", arguments: { command } });
let pass = 0, fail = 0;
function check(name, command, want) {
  const d = m.classify(T(command));
  const got = d === undefined ? undefined : d.kind;
  const ok = got === want;
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"} ${name.padEnd(34)} -> ${String(got)}${ok ? "" : "  want=" + String(want)}`);
  if (!ok) console.log(`        cmd: ${command}`);
}

console.log("--- DENY: the same destination, spelled differently ---");

console.log("  [quotes]");
check("quoted drive root", 'Remove-Item -Recurse -Force "C:\\"', "deny");
check("single-quoted root", "rm -rf 'C:\\'", "deny");

console.log("  [traversal folds to a root]");
check("traversal to root", "rm -rf C:\\Temp\\..\\", "deny");
check("multi-level traversal", "Remove-Item -Recurse -Force D:\\a\\b\\..\\..\\..", "deny");

console.log("  [extended-length prefixes]");
check("\\\\?\\ prefix", "Remove-Item -Recurse -Force \\\\?\\C:\\Windows", "deny");
check("\\\\.\\ prefix", "Remove-Item -Recurse -Force \\\\.\\C:\\Windows", "deny");

console.log("  [8.3 short names of protected roots]");
check("WINDOW~1", "Remove-Item -Recurse -Force C:\\WINDOW~1", "deny");
check("short System32", "Remove-Item -Recurse -Force C:\\WINDOW~1\\SYSTEM~1", "deny");

console.log("  [bare device]");
check("PhysicalDrive0", "Remove-Item -Recurse -Force \\\\.\\PhysicalDrive0", "deny");

console.log("");
console.log("--- PASS: must NOT over-block ---");

console.log("  [ordinary work, must stay allowed]");
check("build dir", "rm -rf ./build", undefined);
check("dist dir", "rm -rf ./dist", undefined);
check("workspace subdir", "Remove-Item -Recurse -Force D:\\proj\\a\\..\\build", undefined);
check("scratch file", "Remove-Item D:\\proj\\tmp.txt", undefined);
check("cross-volume build", "Remove-Item -Recurse -Force D:\\other\\build", undefined);

console.log("  [recoverable targets are OUT of the backstop]");
// The user's ruling: the guard refuses only what the agent cannot undo. An
// installed program can be reinstalled and a user profile is the operator's own
// data, so neither is a DENY — and spelling them `PROGRA~1` does not change that.
check("Program Files (by name)", "Remove-Item -Recurse -Force 'C:\\Program Files'", undefined);
check("Program Files (8.3)", "Remove-Item -Recurse -Force C:\\PROGRA~1", undefined);
check("user profile", "Remove-Item -Recurse -Force C:\\Users\\Administrator", undefined);

console.log("  [reads are never gated]");
check("read drive root", "Get-ChildItem C:\\", undefined);
check("read windows", "Get-ChildItem C:\\Windows -Recurse", undefined);

console.log("");
console.log("D9-SPELLING: pass=" + pass + " fail=" + fail);
if (fail > 0) process.exitCode = 1;
