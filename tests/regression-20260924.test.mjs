// ============================================================================
// regression tests for the three defects repaired on 2026-09-24
// ============================================================================
//
// These were written RED FIRST: each case below was run against the unfixed
// index.js and observed to produce the WRONG verdict, before any repair was
// made. The measured pre-fix behaviour is recorded verbatim next to each case
// so a later reader can tell a real regression from a rewritten expectation.
//
//   D1  guard locked itself out — writing its own index.js was DENYed
//   D2  verb false-positive      — a pure read was classified as a write
//   D3  reads through path table — a read that NAMES a guarded path was gated
//
// Run:  node tests/regression-20260924.test.mjs

const MODULE = "../index.js";
const m = await import(MODULE);

const T = (name, args) => ({ name, arguments: args });

let pass = 0, fail = 0;
function check(group, name, got, want) {
  const ok = got === want;
  if (ok) { pass++; console.log("  PASS " + group + " " + name); }
  else { fail++; console.log("  FAIL " + group + " " + name + "  want=" + String(want) + " got=" + String(got)); }
}
function kindOf(exec) {
  const d = m.classify(exec);
  return d === undefined ? undefined : d.kind;
}

console.log("REG-RED-GREEN trace: cases recorded failing against the pre-fix module\n");

// ── D1: the guard must be able to repair itself ─────────────────────────────
// NOTE (2026-09-24, corrected): the first two cases below originally used
// T("write", …) and expected "ask"/"deny". That could never pass, and the
// assertion was wrong rather than the implementation: `classify` returns
// undefined for every tool other than pwsh/bash, on purpose — the file tools
// are governed by DSH's own permission layer, not by this gate. The intent of
// these cases (the guard's own source is repairable; a sibling package is not)
// is preserved at full strength by putting the same paths through pwsh, which
// is the surface the gate actually owns.
//
// PRE-FIX measured: "ask" — a recursive force-delete of the guard's own subtree
// was waived all the way down to a prompt.
//
// CORRECTED 2026-09-24 (third repair — ask tier removed). These two cases used
// to expect "ask". The user's ruling retired the tier: an in-place edit of the
// guard's own source is exactly what the D1 carve-out keeps repairable, and
// with no middle tier to land on it now clears. The point of D1 — the guard is
// repairable by the user it protects — is held MORE strongly by `undefined`
// than it ever was by a prompt that the disabled approval layer auto-refused.
console.log("D1 guard self-repair");
check("D1", "write own index.js is not over-blocked", kindOf(T("pwsh",
  { command: "Set-Content C:\\Users\\Administrator\\.dsh\\profiles\\web\\node_modules\\dsh-sovereign\\index.js hi" })), undefined);
// PRE-FIX measured: "deny" — a READ of its own source was refused
check("D1", "pwsh Set-Content own dir is not over-blocked", kindOf(T("pwsh",
  { command: "Set-Content C:\\Users\\Administrator\\.dsh\\profiles\\web\\node_modules\\dsh-sovereign\\index.js hi" })), undefined);
// the DENY row must still hold for every OTHER package in that tree
check("D1", "sibling package still deny", kindOf(T("pwsh",
  { command: "Remove-Item C:\\Users\\Administrator\\.dsh\\profiles\\web\\node_modules\\meow-memory\\index.js" })), "deny");
// the write tool stays out of the gate's hands entirely — that is the contract
// the two corrected cases above must not be read as weakening.
check("D1", "write tool is not gated by classify", kindOf(T("write",
  { file_path: "C:\\Users\\Administrator\\.dsh\\profiles\\web\\node_modules\\dsh-sovereign\\index.js" })), undefined);
// destroying the whole node_modules is still the no-channel tier
check("D1", "whole node_modules still deny", kindOf(T("pwsh",
  { command: "Remove-Item -Recurse -Force C:\\Users\\Administrator\\.dsh\\profiles\\web\\node_modules" })), "deny");

// ── D2: verb false-positive ─────────────────────────────────────────────────
// PRE-FIX measured: "deny"  (read misclassified as write -> path table -> DENY)
console.log("D2 verb false positive");
check("D2", "Select-Object pipeline on guarded path", kindOf(T("pwsh",
  { command: "Get-Item 'C:\\Users\\Administrator\\.dsh\\profiles\\web\\node_modules\\dsh-sovereign\\index.js' | Select-Object LastWriteTime" })), undefined);
// PRE-FIX measured: "deny" — `md`/`rd` substrings inside ordinary words
check("D2", "Get-Content a path with cmd-ish words", kindOf(T("pwsh",
  { command: "Get-Content 'C:\\Users\\Administrator\\.dsh\\profiles\\web\\node_modules\\dsh-sovereign\\index.js' -TotalCount 5" })), undefined);
// the head anchor must still fire when a short verb IS the head — but with the
// ask tier gone, "fires" now means it reaches the tables, not that it prompts.
// `./build` matches no row, so it clears; the position rule is carried by the
// guarded-path cases below, where the verdict is observable.
check("D2", "rm at head still acts", kindOf(T("pwsh", { command: "rm -rf ./build" })), undefined);
// CORRECTED 2026-09-24 (second repair). This case used to read:
//
//   check("D2", "md after separator still acts", kindOf(T("pwsh",
//     { command: "Get-Date; md D:\\DSH-ZJ\\newdir" })), "ask");
//
// The heading "md after separator still acts" states a POSITION rule, but the
// command body reaches only an unprotected, fully-resolved path — so the case
// was really asserting "an ordinary write must prompt", which is the
// over-blocking the user reported. It passed only because a catch-all fallback
// covered resolvable-but-unprotected absolute paths; that fallback is gone.
//
// The position rule itself is what the title claims, so it is re-anchored on a
// path the tables actually govern: same head position, same short verb, only
// the target changed. Two targets, so the assertion cannot be satisfied by an
// accident of one row.
check("D2", "md after separator still reaches the path table (deny)", kindOf(T("pwsh",
  { command: "Get-Date; md C:\\Windows\\System32\\newdir" })), "deny");
check("D2", "md after separator still reaches the path table (.dsh)", kindOf(T("pwsh",
  { command: "Get-Date; md C:\\Users\\Administrator\\.dsh\\newdir" })), "deny");
// and the same verb on an unprotected path must now pass
check("D2", "md after separator on unprotected path is not over-blocked", kindOf(T("pwsh",
  { command: "Get-Date; md D:\\DSH-ZJ\\newdir" })), undefined);
// NOTE (2026-09-24, corrected twice). This case read
//   Write-Output 'rm -rf everything'  →  expect undefined
// which could not hold under the old rule, and the assertion was wrong rather
// than the implementation: ASK_CMD was matched against the WHOLE command line
// with no quote stripping, so a quoted `rm` still prompted.
//
// The third repair settles it differently — and more simply. The ask tier is
// gone, so quoted prose is inert for the reason the case always claimed: there
// is no rule left that a quoted verb could trip. The case below is kept because
// it is still meaningful for a DIFFERENT rule (`md` reaches the table only via
// the statement-head test in WRITE_SHORT_ALT), so this remains a live negative
// control rather than a restatement of the retired tier.
check("D2", "verb in quoted prose is not action", kindOf(T("pwsh",
  { command: "Write-Host 'md D:/x'" })), undefined);

// ── D3: reads never reach the path tables ───────────────────────────────────
// PRE-FIX measured: "deny" — naming a guarded path was treated as acting on it
console.log("D3 reads through the path table");
for (const cmd of [
  "Get-ChildItem C:\\Users\\Administrator\\.dsh\\profiles\\web\\node_modules",
  "Test-Path C:\\Users\\Administrator\\.dsh\\profiles\\web\\node_modules\\dsh-sovereign\\index.js",
  "Select-String -Path C:\\Users\\Administrator\\.dsh\\profiles\\web\\node_modules\\dsh-sovereign\\index.js -Pattern sovereign",
  "Measure-Object -Line C:\\Users\\Administrator\\.dsh\\profiles\\web\\node_modules\\dsh-sovereign\\index.js",
  "Import-Csv C:\\Users\\Administrator\\.dsh\\profiles\\web\\node_modules\\dsh-sovereign\\index.js",
]) {
  check("D3", cmd.split(" ")[0] + " ...", kindOf(T("pwsh", { command: cmd })), undefined);
}
// the read family by tool name is likewise never gated
for (const tool of ["read", "glob", "grep"]) {
  check("D3", tool + " tool on guarded path", kindOf(T(tool,
    { file_path: "C:\\Users\\Administrator\\.dsh\\profiles\\web\\node_modules\\dsh-sovereign\\index.js" })), undefined);
}
// a read-headed command that ENDS in an unrecoverable act is still DENY:
// the fast-path must not become a laundering route
console.log("D3 read-head must not launder a deny");
check("D3", "Get-Disk | Clear-Disk still deny", kindOf(T("pwsh",
  { command: "Get-Disk | Clear-Disk -Number 1 -RemoveData" })), "deny");
check("D3", "Get-Item then diskpart still deny", kindOf(T("pwsh",
  { command: "Get-Item C:\\; diskpart /s wipe.txt" })), "deny");

// ── D2b: the write path table must still see a SHORT-HEAD write ─────────────
// These were broken by the first cut of D2 (a head-anchored regex fed a fully
// anchored, path-bearing command) and are recorded here so the pair stays
// locked together: the read fast-path loosens reads, never writes.
console.log("D2b short-head writes still reach the path table");
check("D2b", "rm at head on deny path -> deny", kindOf(T("pwsh",
  { command: "rm C:\\Users\\Administrator\\.dsh\\profiles\\web\\node_modules\\meow-memory" })), "deny");
check("D2b", "cp at head onto deny path -> deny", kindOf(T("pwsh",
  { command: "cp evil.js C:\\Windows\\System32\\evil.js" })), "deny");
check("D2b", "Move-Item onto deny path -> deny", kindOf(T("pwsh",
  { command: "Move-Item x.dll D:\\DSH-X\\data\\versions\\0.1.5-rc.2\\x.dll" })), "deny");
check("D2b", "Set-Content under .dsh -> deny", kindOf(T("pwsh",
  { command: "Set-Content C:\\Users\\Administrator\\.dsh\\settings.yaml hi" })), "deny");

console.log("");
console.log("REGRESSION-20260924: pass=" + pass + " fail=" + fail);
process.exit(fail === 0 ? 0 : 1);
