// Real DSH 0.2.2-rc.1 contract probe.
// Run with the rc1 Electron binary in ELECTRON_RUN_AS_NODE=1 mode and set
// DSH_RC1_ASAR to the official app.asar. No current DSH home or process is used.
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as plugin from "../index.js";

const asarPath = process.env.DSH_RC1_ASAR;
const resultPath = process.env.DSH_RC1_RESULT;
if (!asarPath) {
  console.error("DSH_RC1_ASAR is required (path to the official 0.2.2-rc.1 app.asar)");
  process.exit(2);
}

const result = {
  kind: "dsh-sovereign-rc1-real-api-probe",
  ok: false,
  host: {},
  checks: {},
  observations: {},
  legacyFindings: {},
};
const check = (name, value, detail) => {
  result.checks[name] = value === true;
  console.log(`  ${value === true ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : `  ${JSON.stringify(detail)}`}`);
};
const save = () => {
  if (resultPath) writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
};

let tmp;
try {
  const moduleRoot = join(asarPath, "dsh/node_modules");
  const moduleUrl = (name, file = "lib/index.js") =>
    pathToFileURL(join(moduleRoot, name, file)).href;
  const [{ Context }, { SystemPrompt }, { WebServer }] = await Promise.all([
    import(moduleUrl("@deepseek-ai/cordis")),
    import(moduleUrl("@deepseek-ai/dsh-system-prompt")),
    import(moduleUrl("@deepseek-ai/dsh-host-webserver")),
  ]);
  const hostPackage = JSON.parse(readFileSync(join(asarPath, "dsh/package.json"), "utf8"));
  const cordisPackage = JSON.parse(readFileSync(join(moduleRoot, "@deepseek-ai/cordis/package.json"), "utf8"));
  result.host = {
    asarPath,
    dsh: hostPackage.version,
    cordis: cordisPackage.version,
    node: process.version,
  };
  check("official host is 0.2.2-rc.1", hostPackage.version === "0.2.2-rc.1", result.host);
  check("official Cordis is 4.1.0", cordisPackage.version === "4.1.0");

  tmp = mkdtempSync(join(tmpdir(), "sov-rc1-real-"));
  process.env.DSH_HOME = tmp;
  const stateFile = plugin.switchFilePath();
  const app = new Context();
  const systemPrompt = new SystemPrompt(app, {
    includeHarnessIdentity: true,
    includeRuntimeContext: false,
    personaPrefix: "",
    personaSuffix: "",
  });
  // Construct the real route registry without Service.init, so no socket is opened.
  const webServer = new WebServer(app, {
    host: "127.0.0.1",
    port: 0,
    compression: "none",
    compressionLevel: 1,
    compressionThresholdBytes: 1024,
  });
  app.provide("tools", {});
  app.provide("sessionProjections", { register: () => () => {} });
  plugin.apply(app);

  const callRoute = async (path, method, body) => {
    const route = webServer.exact.get(path);
    if (!route) return { status: 0, json: null };
    const listeners = {};
    const req = {
      method,
      url: path,
      on(event, fn) {
        (listeners[event] ??= []).push(fn);
        return req;
      },
      destroy() {},
    };
    setImmediate(() => {
      if (body !== undefined) {
        for (const fn of listeners.data ?? []) fn(Buffer.from(body, "utf8"));
      }
      for (const fn of listeners.end ?? []) fn();
    });
    let done;
    const finished = new Promise((resolve) => { done = resolve; });
    const res = {
      statusCode: 0,
      body: "",
      writeHead(code) { res.statusCode = code; return res; },
      end(text) { res.body = text ?? ""; done(); },
    };
    await route.handler(req, res);
    await finished;
    let json = null;
    try { json = JSON.parse(res.body); } catch { /* non-JSON is retained as null */ }
    return { status: res.statusCode, json };
  };
  const names = (assembly) => assembly.sections.map((section) => section.name);
  const clauseSha256 = createHash("sha256").update(plugin.CLAUSE).digest("hex").toUpperCase();
  check("clause bytes remain v0.7.0", clauseSha256 === "001218CF76DCBE063717C5A8E28680FA748006AC497DC188AE8FE703BB4C7D84", clauseSha256);

  const initial = await systemPrompt.assemble({});
  result.observations.initialSections = names(initial);
  check("real assemble keeps clause as last section", names(initial).at(-1) === "sovereign:clause", names(initial));
  check("real assemble preserves exact clause text", initial.sections.at(-1)?.text === plugin.CLAUSE);
  check("real assemble retains tools array", Array.isArray(initial.tools));
  const initialState = await callRoute("/plugins/dsh-sovereign/state", "GET");
  check("real WebServer registry exposes state route", initialState.status === 200 && initialState.json?.registered === true, initialState);

  let downstreamCalls = 0;
  app.on("system-prompt/assemble", async (_assembly, _context, next) => {
    downstreamCalls += 1;
    const assembled = await next();
    return { ...assembled, variables: { ...assembled.variables, rc1Downstream: "reached" } };
  });
  const beforeEnabled = downstreamCalls;
  const enabled = await systemPrompt.assemble({});
  check("enabled gate preserves downstream waterfall", downstreamCalls === beforeEnabled + 1 && enabled.variables.rc1Downstream === "reached");

  // Request-level switch only: leave FACE 6 registered and change the sidecar.
  writeFileSync(stateFile, JSON.stringify({ version: 1, clause: false }), "utf8");
  utimesSync(stateFile, new Date(), new Date(Date.now() + 10_000));
  const beforeFiltered = downstreamCalls;
  const filtered = await systemPrompt.assemble({});
  const filteredDownstreamDelta = downstreamCalls - beforeFiltered;
  result.legacyFindings.requestFilterDownstreamCalls = filteredDownstreamDelta;
  result.legacyFindings.requestFilterShortCircuitsDownstream = filteredDownstreamDelta === 0;
  const expectedFilteredNames = names(initial).filter((name) => name !== "sovereign:clause");
  check("request-level off removes only sovereign clause", JSON.stringify(names(filtered)) === JSON.stringify(expectedFilteredNames),
    { expected: expectedFilteredNames, actual: names(filtered) });
  check("request-level off retains tools array", Array.isArray(filtered.tools));
  console.log(`  OBSERVE request-filter downstream calls=${filteredDownstreamDelta} (0 is the pre-existing veto finding, not an rc1 regression)`);

  writeFileSync(stateFile, JSON.stringify({ version: 1, clause: true }), "utf8");
  utimesSync(stateFile, new Date(), new Date(Date.now() + 20_000));
  const restored = await systemPrompt.assemble({});
  check("request-level on restores exact clause", restored.sections.at(-1)?.name === "sovereign:clause"
    && restored.sections.at(-1)?.text === plugin.CLAUSE);

  const off = await callRoute("/plugins/dsh-sovereign/switch", "POST", JSON.stringify({ clause: false }));
  const offAssembly = await systemPrompt.assemble({});
  check("route off disposes real section", off.status === 200 && off.json?.registered === false
    && !names(offAssembly).includes("sovereign:clause"), off);
  const on = await callRoute("/plugins/dsh-sovereign/switch", "POST", JSON.stringify({ clause: true }));
  const onAssembly = await systemPrompt.assemble({});
  check("route on recreates real section", on.status === 200 && on.json?.registered === true
    && onAssembly.sections.at(-1)?.text === plugin.CLAUSE, on);

  const passMarker = { kind: "pass-probe" };
  const passExec = { name: "bash", arguments: { command: "git status" } };
  const passDecision = await app.waterfall(app, "tools/pre-execute", passExec, () => Promise.resolve(passMarker));
  check("real pre-execute waterfall passes ordinary command", passDecision === passMarker, passDecision);
  const denyExec = { name: "web_fetch", arguments: { url: "https://example.invalid", method: "POST" } };
  const denyDecision = await app.waterfall(app, "tools/pre-execute", denyExec, () => Promise.resolve(passMarker));
  check("real pre-execute waterfall preserves deny object", denyDecision?.kind === "deny", denyDecision);

  const secret = "sk-proj-abcdefghijklmnop1234567890";
  const postResult = { isError: false, content: [{ type: "text", text: `credential=${secret}` }] };
  const sanitized = await app.waterfall(app, "tools/post-execute", {}, postResult, () => Promise.resolve(postResult));
  check("real post-execute waterfall returns accepted sanitized content", sanitized?.kind === "accept"
    && sanitized.content?.[0]?.text.includes("«REDACTED:")
    && !sanitized.content?.[0]?.text.includes(secret), sanitized);

  // Record the known complete/post-waterfall visibility limitation explicitly.
  const disposeComplete = systemPrompt.section({
    name: "probe:complete",
    order: 1,
    text: "complete probe",
    complete: true,
  });
  const completed = await systemPrompt.assemble({});
  const completedState = await callRoute("/plugins/dsh-sovereign/state", "GET");
  result.observations.completeFinalSections = names(completed);
  result.legacyFindings.completeActuallyShadowsClause = !names(completed).includes("sovereign:clause");
  result.legacyFindings.completeShadowedField = completedState.json?.shadowed;
  check("rc1 complete semantics remain post-waterfall sole section", names(completed).length === 1
    && names(completed)[0] === "probe:complete", names(completed));
  console.log(`  OBSERVE complete final sections=${JSON.stringify(names(completed))}; reported shadowed=${JSON.stringify(completedState.json?.shadowed)} (known pre-existing detection limitation)`);
  disposeComplete();
  const afterComplete = await systemPrompt.assemble({});
  check("complete disposer restores clause assembly", afterComplete.sections.at(-1)?.text === plugin.CLAUSE);

  result.ok = Object.values(result.checks).every(Boolean);
  result.summary = {
    passed: Object.values(result.checks).filter(Boolean).length,
    failed: Object.values(result.checks).filter((value) => !value).length,
    legacyFindings: result.legacyFindings,
  };
  save();
  console.log(`RC1-REAL-API: ${JSON.stringify(result.summary)}`);
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  result.error = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error);
  result.ok = false;
  save();
  console.error(error);
  process.exitCode = 1;
} finally {
  if (tmp) {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* own temp cleanup is best-effort */ }
  }
}
