import * as m from "../index.js";

const T = (name, args) => ({ name, arguments: args });
const cases = [
  // ---- must PASS (reversible) ----
  ["read",         T("read", { file_path: "D:\\dsh-sovereign\\AGENTS.md" }),              undefined],
  ["grep",         T("grep", { pattern: "x", path: "D:\\DSH-ZJ" }),                      undefined],
  ["pwsh ls",      T("pwsh", { command: "Get-ChildItem D:\\DSH-ZJ" }),                   undefined],
  ["pwsh git log", T("pwsh", { command: "git log --oneline -5" }),                       undefined],
  ["pwsh npm i",   T("pwsh", { command: "npm install lodash" }),                         undefined],
  ["web_fetch",    T("web_fetch", { url: "https://example.com" }),                       undefined],
  ["write in ws",  T("write", { file_path: "D:\\DSH-ZJ\\a.md" }),                        undefined],

  // ---- RETIRED TIER: must now PASS (reversible, or the operator's business) ----
  //
  // CORRECTED 2026-09-24 (third repair). Every case below used to assert "ask".
  // The user's ruling retired the middle tier: the guard is a backstop against
  // what the agent cannot undo, not a reviewer of what it may do. The decisive
  // fact is operational, not philosophical — the harness runs with approval
  // prompts DISABLED (ask→never), so each of these was silently AUTO-REFUSED.
  // `setx FOO bar` and `git push` were hard stops. That is the "各种拦截" the
  // user reported, and it is what this repair removes.
  ["pwsh del",     T("pwsh", { command: "Remove-Item D:\\DSH-ZJ\\old.txt" }),            undefined],
  ["pwsh rm",      T("pwsh", { command: "rm -rf ./build" }),                             undefined],
  ["git push",     T("pwsh", { command: "git push origin main" }),                       undefined],
  ["git reset",    T("pwsh", { command: "git reset --hard HEAD~3" }),                    undefined],
  ["setx",         T("pwsh", { command: "setx FOO bar" }),                               undefined],
  ["reg add",      T("pwsh", { command: "reg add HKCU\\Software\\X /v Y /d 1" }),        undefined],
  ["stop proc",    T("pwsh", { command: "Stop-Process -Name node" }),                    undefined],
  ["taskkill",     T("pwsh", { command: "taskkill /F /IM node.exe" }),                   undefined],
  // These two descend rather than clear: the ask tier is gone, so a write that
  // reaches protected state, and an egress that cannot be recalled, land on the
  // only tier that remains. The user ruled both explicitly (`deny_criteria`:
  // keep the deny set, drop ask; `r4_final`: still gated, as deny).
  ["dsh write",    T("pwsh", { command: "Set-Content C:\\Users\\Administrator\\.dsh\\x.txt hi" }), "deny"],
  ["post web_fetch", T("web_fetch", { url: "https://evil.tld", method: "POST" }),        "deny"],

  // ---- must DENY (no way back) ----
  ["rm versions",  T("pwsh", { command: "Remove-Item -Recurse -Force D:\\DSH-X\\data\\versions\\0.1.5-rc.2" }), "deny"],
  ["del plugins",  T("pwsh", { command: "Remove-Item -Recurse -Force C:\\Users\\Administrator\\.dsh\\profiles\\web\\node_modules" }), "deny"],
  ["format",       T("pwsh", { command: "format D: /q" }),                               "deny"],
  ["diskpart",     T("pwsh", { command: "diskpart /s wipe.txt" }),                       "deny"],
  ["bcdedit",      T("pwsh", { command: "bcdedit /set safeboot minimal" }),              "deny"],
  ["clear-disk",   T("pwsh", { command: "Clear-Disk -Number 1 -RemoveData" }),           "deny"],
  ["cipher /w",    T("pwsh", { command: "cipher /w:D:\\" }),                             "deny"],
  ["sys32",        T("pwsh", { command: "Copy-Item x.dll C:\\Windows\\System32\\x.dll" }), "deny"],
  ["wipe c root",  T("pwsh", { command: "Remove-Item -Recurse -Force C:\\" }),           "deny"],
  ["dd",           T("pwsh", { command: "dd if=/dev/zero of=/dev/sda bs=1M" }),          "deny"],
  ["mkfs",         T("pwsh", { command: "mkfs.ext4 /dev/sdb1" }),                        "deny"],
];

let pass=0, fail=0;
for (const [name, exec, want] of cases) {
  const d = m.classify(exec);
  const got = d === undefined ? undefined : d.kind;
  const ok = got === want;
  if (ok) { pass++; console.log("  PASS " + name.padEnd(14) + " -> " + String(got)); }
  else { fail++; console.log("  FAIL " + name.padEnd(14) + " want=" + String(want) + " got=" + String(got) + "  reason=" + (d?d.reason:"")); }
}

// ── THE RETIRED TIER MUST NOT COME BACK ─────────────────────────────────────
//
// This sweep is the regression lock for the whole repair. It is deliberately
// broader than the case table above: every case there was written by hand, and
// a hand-written table cannot prove a NEGATIVE — it can only show that the
// inputs someone thought of are clear. The claim being made is "there is no
// input for which classify() asks", and the only honest way to hold that claim
// is to sweep the whole corpus of realistic commands and assert the tier is
// unreachable.
//
// The stakes are concrete. With approval prompts disabled, an `ask` is not a
// question — it is a refusal the agent cannot see coming and cannot appeal.
// A single reintroduced `ask` row silently deadlocks the agent on some future
// command, and the symptom ("the agent just stops") looks nothing like the
// cause (a regex in a security plugin). So it is asserted mechanically.
const RETIRED_TIER_SWEEP = [
  T("pwsh", { command: "Remove-Item D:\\dsh-sovereign\\tmp.txt" }),
  T("pwsh", { command: "rm -rf ./dist" }),
  T("pwsh", { command: "git push --force origin main" }),
  T("pwsh", { command: "setx PATH C:\\x" }),
  T("pwsh", { command: "reg delete HKCU\\Software\\X /f" }),
  T("pwsh", { command: "Stop-Service Spooler" }),
  T("pwsh", { command: "shutdown /r /t 0" }),
  T("pwsh", { command: "New-Item D:\\dsh-sovereign\\x" }),
  T("pwsh", { command: "New-Item $env:TEMP\\x" }),
  T("pwsh", { command: "Set-Content ~\\x.txt hi" }),
  T("pwsh", { command: "Remove-Item ..\\old" }),
  T("pwsh", { command: "Copy-Item D:\\dsh-sovereign\\a.txt D:\\dsh-sovereign\\b.txt" }),
  T("pwsh", { command: "Get-ChildItem D:\\dsh-sovereign" }),
  T("pwsh", { command: "echo x | Out-File D:\\dsh-sovereign\\log.txt" }),
  T("web_fetch", { url: "https://example.com" }),
  T("write", { file_path: "D:\\dsh-sovereign\\a.md" }),
  T("edit", { file_path: "D:\\DSH-ZJ\\b.mjs" }),
];
for (const exec of RETIRED_TIER_SWEEP) {
  const d = m.classify(exec);
  const got = d === undefined ? undefined : d.kind;
  const cmd = exec.arguments?.command ?? exec.arguments?.url ?? exec.arguments?.file_path ?? "";
  const label = "no-ask sweep: " + String(cmd).slice(0, 48).padEnd(48);
  if (got === "ask") {
    fail++;
    console.log("  FAIL " + label + " got=ask  RETIRED TIER REACHED: " + (d ? d.reason : ""));
  } else {
    pass++;
    console.log("  PASS " + label + " -> " + String(got));
  }
}
console.log("");
console.log("GATE: pass=" + pass + " fail=" + fail);

