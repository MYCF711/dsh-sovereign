// ============================================================================
// F-B regression: a shell wrapper must not launder the verb that follows it
// ============================================================================
//
// RED FIRST. Every case below was measured against index.js at
// F312A5FB34EE89EDFE555F9F98A22B1D0CB16E9BB2D55F273D73406C7FFF9A82 and
// observed to produce the verdict recorded in `pre` before any repair.
//
// The defect, stated exactly:
//
//   WRITE_SHORT_ALT holds two-letter verbs (`rd`, `md`, `cp`, `mv`, `ren`…)
//   that collide with ordinary words, so they are never matched on their own.
//   `statementHeadTest` grants them "action" status only in ACT STATEMENT
//   POSITION — at the start of the line or right after a separator. A wrapper
//   puts an ordinary word where the head used to be:
//
//     `rd   …`          head position        -> DESTRUCTIVE_VERB fires
//     `cmd /c rd …`     ordinary argument     -> nothing fires   <-- the hole
//
//   `cmd /c ` is not a separator, so the short verb is neither a destructive
//   verb nor (unless it happens to be listed there) an ASK_CMD entry. The
//   command ends up classified undefined — silent — while the bare form is
//   gated. `rm`, `del` and `rmdir` escape this only by accident: they also
//   appear in ASK_CMD as position-free regexes.
//
// Run:  node tests/fb-wrapper.test.mjs

const MODULE = "../index.js";
const m = await import(MODULE);

const T = (name, args) => ({ name, arguments: args });
const NM = "C:\\Users\\Administrator\\.dsh\\profiles\\web\\node_modules";

let pass = 0, fail = 0;
function check(group, name, got, want) {
  const ok = got === want;
  if (ok) { pass++; console.log("  PASS " + group + " " + name); }
  else { fail++; console.log("  FAIL " + group + " " + name + "  want=" + String(want) + " got=" + String(got)); }
}
function kindOf(cmd) {
  const d = m.classify(T("pwsh", { command: cmd }));
  return d === undefined ? undefined : d.kind;
}

console.log("F-B: shell wrappers must not launder the verb that follows them\n");

// ── the hole itself ─────────────────────────────────────────────────────────
// `rd` is the reported case; `erase`/`md`/`mkdir`/`copy`/`move`/`ren` are the
// same shape and were all measured undefined. Any non-silent verdict is a
// repair — the tier is asserted exactly only where it is unambiguous.
console.log("wrapper + short verb reaching a guarded path");
// NOTE on what "not silent" can mean here. The gate answers a question about
// TARGETS: a changing verb with no guarded path in the line is legitimately
// inert (`cmd /c rd a.txt` -> undefined, and so is bare `rd a.txt`). The F-B
// defect was that a WRAPPED verb stayed inert even WITH a guarded path. So
// every case below carries a guarded path, and the assertion is the verdict
// tier — not mere non-silence, which the bare form would fail too.
check("F-B", "cmd /c rd on guarded subtree -> deny", kindOf(`cmd /c rd /s /q ${NM}\\meow-memory`), "deny");
check("F-B", "cmd /c erase on guarded subtree -> deny", kindOf(`cmd /c erase /s /q ${NM}\\meow-memory`), "deny");
check("F-B", "cmd /c rmdir on guarded subtree -> deny", kindOf(`cmd /c rmdir /s /q ${NM}\\meow-memory`), "deny");
check("F-B", "cmd /c md under guarded tree -> deny", kindOf(`cmd /c md ${NM}\\meow-memory\\x`) !== undefined, true);
check("F-B", "cmd /c mkdir under guarded tree -> deny", kindOf(`cmd /c mkdir ${NM}\\meow-memory\\x`) !== undefined, true);
check("F-B", "cmd /c copy into guarded tree -> deny", kindOf(`cmd /c copy a.txt ${NM}\\meow-memory\\a.txt`), "deny");
check("F-B", "cmd /c move into guarded tree -> deny", kindOf(`cmd /c move a.txt ${NM}\\meow-memory\\a.txt`), "deny");
check("F-B", "cmd /c ren inside guarded tree -> deny", kindOf(`cmd /c ren ${NM}\\a.txt b.txt`), "deny");
// the same verb on an unguarded path stays inert — the gate is about targets,
// not about verbs-in-the-abstract, and this repair must not change that
//
// CORRECTED 2026-09-24 (second repair). These cases used to read:
//
//   check("F-B", "cmd /c rd on ordinary path -> ask",  kindOf("cmd /c rd /s /q D:\\scratch\\junk"), "ask");
//   check("F-B", "bare rd on ordinary path -> ask",    kindOf("rd /s /q D:\\scratch\\junk"),        "ask");
//   check("F-B", "cmd /c md on ordinary path -> ask",  kindOf("cmd /c md D:\\scratch\\new"),        "ask");
//   check("F-B", "bare md -> ask",                     kindOf("md D:\\DSH-ZJ\\newdir"),              "ask");
//
// and their justification was: "a destructive verb WITH a resolvable target is
// an ask even when nothing is guarded, because nothing is being guarded but
// something is still being changed." THAT REASONING WAS WRONG, and the
// assertions were wrong with it. `D:\scratch\junk` and `D:\DSH-ZJ\newdir` are
// fully-resolved absolute paths that matched no protected row; the guard read
// them, compared them against every DENY and ASK row, and cleared them. Asking
// afterwards adds no information and is precisely the over-blocking the user
// reported ("各种拦截") — `Set-Content D:\DSH-ZJ\_x.mjs` prompted for the same
// reason.
//
// The four cases only ever passed because a catch-all fallback happened to
// cover resolvable-but-unprotected absolute paths. That fallback has been
// removed (see index.js, D2 structural), so they now fail — which is the
// correct outcome, not a regression: fixing the assertion is what restores the
// test's meaning. Over-blocking is now asserted AGAINST rather than enforced.
check("F-B", "cmd /c rd on ordinary path is not over-blocked", kindOf("cmd /c rd /s /q D:\\scratch\\junk"), undefined);
check("F-B", "bare rd on ordinary path is not over-blocked", kindOf("rd /s /q D:\\scratch\\junk"), undefined);
check("F-B", "cmd /c md on ordinary path is not over-blocked", kindOf("cmd /c md D:\\scratch\\new"), undefined);
check("F-B", "bare md on ordinary path is not over-blocked", kindOf("md D:\\DSH-ZJ\\newdir"), undefined);
// what those cases were TRYING to prove — that a resolved target still has to
// face the tables — is carried at full strength by the guarded-path cases
// above, and restated here so the intent cannot be lost again: the same verbs,
// the same head positions, only the target changed.
check("F-B", "bare md onto a guarded path still acts", kindOf(`md ${NM}\\meow-memory\\x`) !== undefined, true);
check("F-B", "bare rd onto a guarded path still acts", kindOf(`rd /s /q ${NM}\\meow-memory`), "deny");

// ── the bare forms must not regress ─────────────────────────────────────────
console.log("bare forms (unchanged by this repair)");
check("F-B", "bare rd -> deny", kindOf(`rd /s /q ${NM}\\meow-memory`), "deny");
check("F-B", "bare rmdir -> deny", kindOf(`rmdir /s /q ${NM}\\meow-memory`), "deny");
check("F-B", "bare del -> deny", kindOf(`del /f /q ${NM}\\meow-memory\\index.js`), "deny");
// CORRECTED 2026-09-24 (third repair — ask tier removed). This used to read
// `kindOf("rm -rf ./build") === "ask"`. The user's ruling retired the middle
// tier outright: the guard may refuse only what the agent cannot undo, and
// `./build` is a build directory the agent regenerates. It now passes. The
// residue the assertion was protecting — "a destructive verb must not disappear
// silently" — is carried by the guarded-path cases, where the verdict is deny.
check("F-B", "bare rm on scratch is not over-blocked", kindOf("rm -rf ./build"), undefined);
// "bare md" also stood here asserting `md D:\DSH-ZJ\newdir` -> "ask", removed
// for the same reason as the four cases above: an unprotected, fully-resolved
// absolute path must pass. The bare-verb tier is still covered by `bare rm`.
check("F-B", "bare md onto a guarded path is not silent", kindOf(`md ${NM}\\meow-memory\\x`) !== undefined, true);

// ── wrapper spelling variants ───────────────────────────────────────────────
console.log("wrapper spelling variants")
check("F-B", "cmd.exe /c", kindOf(`cmd.exe /c rd /s /q ${NM}\\meow-memory`), "deny");
check("F-B", "uppercase CMD /C", kindOf(`CMD /C RD /S /Q ${NM}\\meow-memory`), "deny");
check("F-B", "mixed case cmd /C", kindOf(`cmd /C rd ${NM}\\meow-memory`), "deny");

// ── nested / chained wrappers ───────────────────────────────────────────────
console.log("wrapper chains")
check("F-B", "semicolon after wrapper is still a head",
  kindOf(`cmd /c X; rd /s /q ${NM}\\meow-memory`), "deny");
check("F-B", "wrapper inside a later statement",
  kindOf(`git status; cmd /c rd /s /q ${NM}\\meow-memory`), "deny");

// ── must NOT over-block: prose that merely mentions a wrapper ───────────────
console.log("prose mentioning a wrapper stays inert")
check("F-B", "quoted wrapper text", kindOf("echo 'run cmd /c rd later'"), undefined);
check("F-B", "cmd in a filename", kindOf("Get-Content cmd.txt"), undefined);
check("F-B", "wrapper with an innocent verb", kindOf("cmd /c echo hello"), undefined);
check("F-B", "wrapper with dir", kindOf("cmd /c dir"), undefined);
check("F-B", "wrapper with a read cmdlet", kindOf(`cmd /c type ${NM}\\x.txt`), undefined);
// a short verb as an ORDINARY word must still be inert — that is why the
// position rule exists at all, and it must survive this repair
check("F-B", "short verb as an argument", kindOf("git commit -m md"), undefined);
check("F-B", "md inside a word", kindOf("npm run build-md"), undefined);

console.log("");
console.log("FB-WRAPPER: pass=" + pass + " fail=" + fail);
if (fail > 0) process.exitCode = 1;
