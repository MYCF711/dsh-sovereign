// ============================================================================
// regression tests for the guard's workspace-name collision (2026-09-24 #2)
// ============================================================================
//
// WRITTEN RED FIRST. Every case below was run against the shipped index.js
// (SHA256 8292468FB9104031EB26545E548016D835E43C68A6E57F1C67F6DEDFD51AE655,
// 33298 bytes) and observed to produce the WRONG verdict before any repair.
//
// THE DEFECT: `GUARD_SELF = /[\\/]dsh-sovereign(?:[\\/]|$)/i` was never
// anchored to the plugin INSTALL location, so it also matched the WORKSPACE
// path `D:\dsh-sovereign`. Every write under the working directory was then
// labelled "edits the guard itself" and raised an approval prompt. Measured
// live in session 5501164a:
//
//   approval/asked reason="writing under D:\dsh-sovereign\_zsd.mjs edits the
//   guard itself; this is the one path kept repairable"
//
// The two paths are not the same thing and must not share a verdict:
//
//   install  C:\Users\Administrator\.dsh\profiles\web\node_modules\dsh-sovereign\
//   workspace D:\dsh-sovereign\
//
// Run:  node tests/workspace-collision.test.mjs
//
// ---------------------------------------------------------------------------
// PRE-FIX MEASURED (recorded verbatim from node _repro_guard.mjs, 2026-09-24)
// ---------------------------------------------------------------------------
//   ASK   New-Item -ItemType Directory D:\dsh-sovereign\_testout
//         reason: writing under D:\dsh-sovereign\_testout edits the guard itself
//   ASK   Out-File D:\dsh-sovereign\_a.txt
//         reason: writing under D:\dsh-sovereign\_a.txt edits the guard itself
//   ASK   Add-Content D:\dsh-sovereign\_a.txt x
//         reason: writing under D:\dsh-sovereign\_a.txt edits the guard itself
//   ASK   Set-Content D:\DSH-ZJ\_x.mjs
//         reason: path-changing verb with no resolvable target
//   ASK   echo x | Out-File ...\dsh-sovereign\index.js
//         reason: writing under ...\index.js touches live user state
//   PASS  cat a.txt > C:\Users\Administrator\.dsh\x.txt        <- false negative
// ============================================================================

const MODULE = "../index.js";
const m = await import(MODULE);

const INSTALL = "C:\\Users\\Administrator\\.dsh\\profiles\\web\\node_modules\\dsh-sovereign";
const T = (name, args) => ({ name, arguments: args });

let pass = 0, fail = 0;
function check(group, name, got, want, note) {
  const ok = got === want;
  if (ok) { pass++; console.log("  PASS " + group + " " + name); }
  else {
    fail++;
    console.log("  FAIL " + group + " " + name + "  want=" + String(want) + " got=" + String(got));
    if (note) console.log("       " + note);
  }
}
function kindOf(exec) {
  const d = m.classify(exec);
  return d === undefined ? undefined : d.kind;
}
function reasonOf(exec) {
  const d = m.classify(exec);
  return d === undefined ? "(passed)" : d.reason;
}

console.log("WORKSPACE-COLLISION: written RED against the pre-fix module\n");

// ── R1: the workspace is NOT the guard ─────────────────────────────────────
// Every one of these is ordinary scratch work in the user's own working
// directory. It cannot reach the plugin instance and must not be gated.
console.log("R1 plain writes in the workspace must pass");
check("R1", "New-Item scratch dir", kindOf(T("pwsh",
  { command: "New-Item -ItemType Directory D:\\dsh-sovereign\\_testout" })), undefined,
  "PRE-FIX: ask (edits the guard itself)");
check("R1", "Out-File scratch", kindOf(T("pwsh",
  { command: "Out-File D:\\dsh-sovereign\\_a.txt" })), undefined,
  "PRE-FIX: ask (edits the guard itself)");
check("R1", "Add-Content scratch", kindOf(T("pwsh",
  { command: "Add-Content D:\\dsh-sovereign\\_a.txt x" })), undefined,
  "PRE-FIX: ask (edits the guard itself)");
check("R1", "Set-Content probe script", kindOf(T("pwsh",
  { command: "Set-Content -Encoding UTF8 D:\\dsh-sovereign\\_zsd.mjs" })), undefined,
  "PRE-FIX: ask (edits the guard itself)");
check("R1", "Set-Content outside .dsh entirely", kindOf(T("pwsh",
  { command: "Set-Content -Encoding UTF8 D:\\DSH-ZJ\\_x.mjs" })), undefined,
  "PRE-FIX: ask (path-changing verb with no resolvable target)");
check("R1", "Remove-Item one workspace scratch file", kindOf(T("pwsh",
  { command: "Remove-Item D:\\dsh-sovereign\\_a.txt" })), undefined,
  "CORRECTED 2026-09-24: was want=ask. A scratch file the agent just wrote is regenerable, which is the user's own test for passing.");

// ── R2: the INSTALL path keeps its own, stricter verdicts ──────────────────
// Repairing the collision must not loosen the guard's grip on its own source.
console.log("R2 the install path keeps its verdicts");
check("R2", "in-place edit of own index.js is not over-blocked", kindOf(T("pwsh",
  { command: "Set-Content " + INSTALL + "\\index.js hi" })), undefined,
  "CORRECTED 2026-09-24: was want=ask. An in-place edit is exactly what the D1 carve-out keeps repairable, and the ask tier no longer exists to land on.");
check("R2", "sibling package -> deny", kindOf(T("pwsh",
  { command: "Remove-Item " + INSTALL.replace("dsh-sovereign", "meow-memory") + "\\index.js" })), "deny");
check("R2", "whole node_modules -> deny", kindOf(T("pwsh",
  { command: "Remove-Item -Recurse -Force C:\\Users\\Administrator\\.dsh\\profiles\\web\\node_modules" })), "deny");
check("R2", "recursive force delete of own subtree -> deny", kindOf(T("pwsh",
  { command: "Remove-Item -Recurse -Force " + INSTALL })), "deny");

// ── R3: the guard must be able to back itself up ───────────────────────────
// Copying the source to a NON-protected destination destroys nothing and is
// the precondition for every repair (禁止不可复原操作 requires a backup first).
console.log("R3 backing up the guard is not destruction");
check("R3", "copy own source out to workspace", kindOf(T("pwsh",
  { command: "Copy-Item " + INSTALL + "\\index.js D:\\dsh-sovereign\\_BACKUP-index.js" })), undefined,
  "PRE-FIX: deny (would destroy the running runtime)");
check("R3", "copy own source to a sibling backup name", kindOf(T("pwsh",
  { command: "Copy-Item " + INSTALL + "\\index.js " + INSTALL + ".bak" })), undefined,
  "CORRECTED 2026-09-24: was want=ask. A copy writes a NEW file and leaves the original byte-for-byte intact — there is an undo path, so the backstop must not fire.");

// ── R4: the most dangerous write must not be the mildest verdict ───────────
// Overwriting the guard's own index.js through a redirect reaches the same
// file as the Set-Content form above; it must not come out softer.
//
// CORRECTED 2026-09-24: these three used to want "ask", and the first carried a
// reason about "live user state" that was simply the wrong rule. The user ruled
// R4 explicitly (`r4_final`): a redirect onto protected state is still gated,
// and it is a DENY rather than a prompt — `>` truncates the target before the
// command runs, so there is nothing left to decide by the time a prompt could
// be shown. Note this is why the guard's own index.js DENIES here while the
// Set-Content form in R2 clears: an in-place edit is the operator's deliberate
// act, a redirect truncation is not.
console.log("R4 redirect-overwrite of the guard is not softer than Set-Content");
check("R4", "echo | Out-File own index.js", kindOf(T("pwsh",
  { command: "echo x | Out-File " + INSTALL + "\\index.js" })), "deny",
  "was ask with a WRONG reason (touches live user state)");
check("R4", "cat redirect onto own index.js", kindOf(T("pwsh",
  { command: "cat a.txt > " + INSTALL + "\\index.js" })), "deny",
  "PRE-FIX: undefined — a read head laundered the redirect");
check("R4", "cat redirect onto .dsh state", kindOf(T("pwsh",
  { command: "cat a.txt > C:\\Users\\Administrator\\.dsh\\x.txt" })), "deny",
  "PRE-FIX: undefined — silent overwrite of live user state");
// and the negative control for D7: a redirect to an ordinary scratch file is
// still just a write, so the new pass must not turn every `>` into a refusal
check("R4", "redirect to a workspace scratch file is not blocked", kindOf(T("pwsh",
  { command: "cat a.txt > D:\\dsh-sovereign\\_scratch.txt" })), undefined);

console.log("");
console.log("WORKSPACE-COLLISION: pass=" + pass + " fail=" + fail);
process.exit(fail === 0 ? 0 : 1);
