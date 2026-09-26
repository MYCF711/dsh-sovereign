import * as m from "../index.js";
const T = (name, args) => ({ name, arguments: args });

// Adversarial: the DENY tier must not be reachable by trivial spelling changes.
// Every one of these MUST stay deny.
const denyBypass = [
  ["no trailing slash",  "Remove-Item -Recurse -Force C:\\Users\\Administrator\\.dsh\\profiles\\web\\node_modules"],
  ["forward slashes",    "Remove-Item -Recurse -Force C:/Users/Administrator/.dsh/profiles/web/node_modules"],
  ["subpath inside",     "Remove-Item C:\\Users\\Administrator\\.dsh\\profiles\\web\\node_modules\\dsh-sovereign -Recurse -Force"],
  ["versions no slash",  "Remove-Item -Recurse -Force D:\\DSH-X\\data\\versions"],
  ["versions subpath",   "Remove-Item -Recurse -Force D:\\DSH-X\\data\\versions\\0.1.5-rc.2\\node_modules"],
  ["system32 no slash",  "Copy-Item x.dll C:\\Windows\\System32"],
  ["lowercase path",     "remove-item -recurse -force d:\\dsh-x\\data\\versions\\0.1.5-rc.2"],
  ["mixed case",         "Remove-Item -Recurse -Force D:\\dsh-x\\DATA\\Versions\\x"],
];

// Adversarial: the PASS tier must not be over-blocking. These must stay undefined.
const noOverblock = [
  ["reading dsh",        T("read", { file_path: "C:\\Users\\Administrator\\.dsh\\settings.yaml" })],
  ["grep dsh",           T("grep", { pattern: "x", path: "C:\\Users\\Administrator\\.dsh" })],
  ["ls versions",        T("pwsh", { command: "Get-ChildItem D:\\DSH-X\\data\\versions" })],
  ["git status",         T("pwsh", { command: "git status --short" })],
  ["npm test",           T("pwsh", { command: "npm test" })],
  ["node script",        T("pwsh", { command: "node build.mjs" })],
  ["write doc",          T("write", { file_path: "D:\\dsh-sovereign\\docs\\x.md" })],
  ["copy file",          T("pwsh", { command: "Copy-Item a.txt b.txt" })],
  ["mkdir",              T("pwsh", { command: "New-Item -ItemType Directory X" })],
  ["GET default",        T("web_fetch", { url: "https://docs.example.com/page" })],
];

let pass=0, fail=0;
console.log("--- DENY must hold against spelling changes ---");
for (const [n, cmd] of denyBypass) {
  const d = m.classify(T("pwsh", { command: cmd }));
  const got = d ? d.kind : undefined;
  if (got === "deny") { pass++; console.log("  PASS " + n); }
  else { fail++; console.log("  FAIL " + n + " -> got=" + String(got) + "  cmd=" + cmd.slice(0,70)); }
}
console.log("");
console.log("--- PASS must not over-block ---");
for (const [n, exec] of noOverblock) {
  const d = m.classify(exec);
  const got = d ? d.kind : undefined;
  if (got === undefined) { pass++; console.log("  PASS " + n); }
  else { fail++; console.log("  FAIL " + n + " -> got=" + String(got) + " reason=" + d.reason); }
}
console.log("");
console.log("ADVERSARIAL: pass=" + pass + " fail=" + fail);

