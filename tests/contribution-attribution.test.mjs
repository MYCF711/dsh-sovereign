import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

import * as core from "../lib/check-pr-attribution.mjs";
import {
  armContributionGuard,
  contributionOperations,
  createContributionGuard,
} from "../lib/contribution-guard.js";

const REPO = "MYCF711/dsh-session-superagent";
const ROOT = `/repos/${REPO}`;
const TOKEN = "contribution-test-secret";

function pull(number, login) {
  return { number, user: { login } };
}

function commit(sha, login, message = "implement fix", parentCount = 1) {
  return {
    sha,
    author: login ? { login } : null,
    parents: Array.from({ length: parentCount }, (_, index) => ({ sha: `parent-${index}` })),
    commit: { message },
  };
}

function fakeApi(routes) {
  const calls = [];
  const api = async (requestPath) => {
    calls.push(requestPath);
    const path = requestPath.split("?")[0];
    if (!Object.hasOwn(routes, path)) throw new Error(`Unexpected API request: ${requestPath}`);
    const value = routes[path];
    if (value instanceof Error) throw value;
    return typeof value === "function" ? value(requestPath) : value;
  };
  api.calls = calls;
  return api;
}

function fakeExec(routes = {}) {
  const calls = [];
  const execFileImpl = (file, args, options, callback) => {
    const key = `${file} ${args.join(" ")}`;
    calls.push({ file, args, options, key });
    if (!Object.hasOwn(routes, key)) {
      const error = new Error(`Unexpected exec: ${key}`);
      error.code = 1;
      callback(error, "", "unexpected exec");
      return;
    }
    const value = routes[key];
    if (value instanceof Error) {
      callback(value, "", value.message);
      return;
    }
    callback(null, typeof value === "string" ? value : JSON.stringify(value), "");
  };
  execFileImpl.calls = calls;
  return execFileImpl;
}

function noMergeExec(extra = {}) {
  const missing = new Error("no MERGE_HEAD");
  missing.code = 1;
  return fakeExec({
    "git rev-parse --verify -q MERGE_HEAD": missing,
    "gh repo view --json nameWithOwner": { nameWithOwner: REPO },
    ...extra,
  });
}

function branchExec(sha = "shared-sha", head = "HEAD") {
  return fakeExec({
    [`git merge-base ${head} main`]: "base-sha\n",
    [`git log --no-merges --format=%H base-sha..${head}`]: `${sha}\n`,
  });
}

function issueRoutes() {
  return {
    [`${ROOT}/issues/39`]: {
      number: 39,
      user: { login: "octocat" },
      author_association: "CONTRIBUTOR",
      body: "建议改法\n```js\nconst answer = 42\n```",
    },
    [`${ROOT}/issues/39/comments`]: [],
  };
}

function sharedRoutes(currentLogin = "maintainer") {
  const shared = commit("shared-sha", "external-author");
  return {
    "/user": { login: currentLogin },
    [`${ROOT}/pulls`]: [pull(41, "external-author")],
    [`${ROOT}/pulls/41/commits`]: [shared],
  };
}

const execShape = (name, args) => ({ name, arguments: args });
const nextSpy = () => {
  const next = () => {
    next.calls += 1;
    return "next-result";
  };
  next.calls = 0;
  return next;
};

test("快照除明确文件头/增量导出外与 root core SHA256 一致", () => {
  const text = readFileSync(new URL("../lib/check-pr-attribution.mjs", import.meta.url), "utf8");
  const begin = "// === BEGIN UPSTREAM BODY (byte-identical; additive exports follow the end marker) ===\n";
  const end = "// === END UPSTREAM BODY ===";
  const upstream = "#!/usr/bin/env node\n" + text.split(begin)[1].split(end)[0];
  assert.equal(
    createHash("sha256").update(upstream).digest("hex"),
    "ee06cf2110fbc2f43051e9594fd37ceb99e39a64623eb46d22eb2b74ea446771",
  );
  assert.match(text, /Source commit: 4b475f8c4ac43a45ed27018731f0850fb900f89f/);
});

test("fake ctx 注册 pre-execute；fake core merge #49 DENY 且只调用一次", async () => {
  const listeners = {};
  const ctx = {
    on(event, listener) {
      listeners[event] = listener;
      return () => { delete listeners[event]; };
    },
  };
  const calls = [];
  const fakeCore = {
    ...core,
    async checkAttribution(options) {
      calls.push(options);
      return {
        status: "FAIL",
        failures: [{
          type: "shared-commit", short: "shared-", author: "external-author",
          originalPr: 41, originalAuthor: "external-author",
        }],
      };
    },
  };
  const api = fakeApi({});
  armContributionGuard(ctx, { core: fakeCore, api });
  assert.equal(typeof listeners["tools/pre-execute"], "function");
  const next = nextSpy();
  const decision = await listeners["tools/pre-execute"](
    execShape("bash", { command: `gh pr merge 49 --repo ${REPO}` }),
    next,
  );
  assert.equal(decision.kind, "deny");
  assert.match(decision.reason, /应回 PR #41/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].pr, 49);
  assert.equal(next.calls, 0);
  assert.equal(api.calls.length, 0);
});

test("git commit 无 issue 引用直接 next，exec/core/API 全为零", async () => {
  const execFileImpl = fakeExec();
  const api = fakeApi({});
  let coreCalls = 0;
  const fakeCore = {
    ...core,
    async checkCommitAttribution() { coreCalls += 1; throw new Error("must not run"); },
  };
  const guard = createContributionGuard({ core: fakeCore, execFileImpl, api });
  const next = nextSpy();
  const result = await guard(execShape("bash", { command: 'git commit -m "ordinary change"' }), next);
  assert.equal(result, "next-result");
  assert.equal(next.calls, 1);
  assert.equal(execFileImpl.calls.length, 0);
  assert.equal(api.calls.length, 0);
  assert.equal(coreCalls, 0);
});

test("git commit issue 缺 Co-authored-by DENY；token 仅入 gh 环境", async () => {
  const execFileImpl = noMergeExec();
  const api = fakeApi(issueRoutes());
  const guard = createContributionGuard({ execFileImpl, api, env: { GH_TOKEN: TOKEN } });
  const next = nextSpy();
  const decision = await guard(execShape("pwsh", { command: 'git commit -m "fix #39"' }), next);
  assert.equal(decision.kind, "deny");
  assert.match(decision.reason, /#39/);
  assert.match(decision.reason, /@octocat/);
  assert.match(decision.reason, /Co-authored-by: octocat/);
  assert.equal(next.calls, 0);
  assert.equal(execFileImpl.calls.length, 2);
  assert.equal(api.calls.length, 2);
  for (const call of execFileImpl.calls) {
    assert.equal(call.args.join(" ").includes(TOKEN), false);
    if (call.file === "gh") assert.equal(call.options.env.GH_TOKEN, TOKEN);
    if (call.file === "git") assert.equal(call.options.env.GH_TOKEN, undefined);
  }
});

test("git commit -F 有 noreply Co-authored-by PASS", async () => {
  const execFileImpl = noMergeExec();
  const api = fakeApi(issueRoutes());
  const reads = [];
  const guard = createContributionGuard({
    execFileImpl,
    api,
    async readFileImpl(path, encoding) {
      reads.push({ path, encoding });
      return "fix #39\n\nCo-authored-by: Octo Cat <123+octocat@users.noreply.github.com>";
    },
  });
  const next = nextSpy();
  const result = await guard(execShape("bash", { command: "git commit -F message.txt" }), next);
  assert.equal(result, "next-result");
  assert.equal(next.calls, 1);
  assert.deepEqual(reads, [{ path: "message.txt", encoding: "utf8" }]);
  assert.equal(api.calls.length, 2);
});

test("真实 core：gh pr merge #49 共享 #41 外部提交 DENY", async () => {
  const shared = commit("shared-sha", "external-author");
  const api = fakeApi({
    [`${ROOT}/pulls/49`]: pull(49, "maintainer"),
    [`${ROOT}/pulls/49/commits`]: [shared],
    [`${ROOT}/pulls`]: [pull(49, "maintainer"), pull(41, "external-author")],
    [`${ROOT}/pulls/41/commits`]: [shared],
  });
  const guard = createContributionGuard({ api, execFileImpl: fakeExec() });
  const next = nextSpy();
  const decision = await guard(execShape("bash", { command: `gh pr merge 49 --repo ${REPO}` }), next);
  assert.equal(decision.kind, "deny");
  assert.match(decision.reason, /应回 PR #41/);
  assert.equal(api.calls.length, 4);
  assert.equal(next.calls, 0);
});

test("github PUT pulls/N/merge 走 checkAttribution，repo/pr 解析正确", async () => {
  const calls = [];
  const fakeCore = {
    ...core,
    async checkAttribution(options) {
      calls.push(options);
      return { status: "PASS", failures: [] };
    },
  };
  const guard = createContributionGuard({ core: fakeCore, api: fakeApi({}) });
  const next = nextSpy();
  const result = await guard(execShape("github", {
    method: "PUT", path: `repos/${REPO}/pulls/49/merge`,
  }), next);
  assert.equal(result, "next-result");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].repo, REPO);
  assert.equal(calls[0].pr, 49);
  assert.equal(next.calls, 1);
});

test("gh pr create 共享 #41 外部非 merge SHA DENY，merge-base/log 各一次", async () => {
  const execFileImpl = branchExec();
  const api = fakeApi(sharedRoutes());
  const guard = createContributionGuard({ execFileImpl, api });
  const next = nextSpy();
  const decision = await guard(
    execShape("bash", { command: `gh pr create --repo ${REPO} --base main --title test --body test` }),
    next,
  );
  assert.equal(decision.kind, "deny");
  assert.match(decision.reason, /应回 PR #41/);
  assert.equal(execFileImpl.calls.length, 2);
  assert.deepEqual(execFileImpl.calls.map((call) => call.file), ["git", "git"]);
  assert.equal(api.calls.length, 3);
  assert.equal(next.calls, 0);
});

test("原作者 gh pr create PASS，且不读取自己开放 PR 的 commits", async () => {
  const execFileImpl = branchExec();
  const api = fakeApi(sharedRoutes("external-author"));
  const guard = createContributionGuard({ execFileImpl, api });
  const next = nextSpy();
  const result = await guard(
    execShape("pwsh", { command: `gh pr create --repo ${REPO} --base main` }),
    next,
  );
  assert.equal(result, "next-result");
  assert.equal(next.calls, 1);
  assert.equal(execFileImpl.calls.length, 2);
  assert.equal(api.calls.length, 2);
  assert.equal(api.calls.some((path) => path.includes("/pulls/41/commits")), false);
});

test("github POST pulls 创建 PR 复用本地 SHA 与 checkBranchAttribution", async () => {
  const calls = [];
  const fakeCore = {
    ...core,
    async checkBranchAttribution(options) {
      calls.push(options);
      return {
        status: "FAIL",
        failures: [{
          type: "shared-commit", sha: "shared-sha", short: "shared-", author: "external-author",
          originalPr: 41, originalAuthor: "external-author",
        }],
      };
    },
  };
  const guard = createContributionGuard({ core: fakeCore, execFileImpl: branchExec("shared-sha", "feature"), api: fakeApi({}) });
  const next = nextSpy();
  const decision = await guard(execShape("github", {
    method: "POST",
    path: `repos/${REPO}/pulls`,
    body: JSON.stringify({ base: "main", head: "feature", title: "test" }),
  }), next);
  assert.equal(decision.kind, "deny");
  assert.match(decision.reason, /应回 PR #41/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].repo, REPO);
  assert.deepEqual(calls[0].shas, ["shared-sha"]);
  assert.equal(next.calls, 0);
});

test("merge commit 与其他命令不联网；普通 next 各一次", async () => {
  const execFileImpl = fakeExec({ "git rev-parse --verify -q MERGE_HEAD": "merge-head-sha\n" });
  const api = fakeApi({});
  const guard = createContributionGuard({ execFileImpl, api });
  for (const command of ["git merge --no-ff -m 'Merge #41'", "git status", "echo 'gh pr merge 49'"]) {
    const next = nextSpy();
    assert.equal(await guard(execShape("bash", { command }), next), "next-result");
    assert.equal(next.calls, 1);
  }
  const next = nextSpy();
  assert.equal(await guard(execShape("bash", { command: 'git commit -m "Merge #41"' }), next), "next-result");
  assert.equal(next.calls, 1);
  assert.equal(execFileImpl.calls.length, 1);
  assert.equal(api.calls.length, 0);
});

test("checkBranchAttribution 共享 merge SHA 跳过", async () => {
  const api = fakeApi({
    "/user": { login: "maintainer" },
    [`${ROOT}/pulls`]: [pull(41, "external-author")],
    [`${ROOT}/pulls/41/commits`]: [commit("merge-sha", "external-author", "merge", 2)],
  });
  const result = await core.checkBranchAttribution({ repo: REPO, shas: ["merge-sha"], api });
  assert.equal(result.status, "PASS");
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.skipped, [{ type: "merge", sha: "merge-sha" }]);
});

test("API 失败 DENY，reason 可操作且 token 不泄漏", async () => {
  const api = fakeApi({ [`${ROOT}/pulls/49`]: new Error(`HTTP 500 ${TOKEN}`) });
  const guard = createContributionGuard({ api, env: { GH_TOKEN: TOKEN } });
  const next = nextSpy();
  const decision = await guard(execShape("bash", { command: `gh pr merge 49 --repo ${REPO}` }), next);
  assert.equal(decision.kind, "deny");
  assert.match(decision.reason, /gh auth status/);
  assert.match(decision.reason, /HTTP 500/);
  assert.equal(decision.reason.includes(TOKEN), false);
  assert.equal(next.calls, 0);
  assert.equal(api.calls.length, 1);
});

test("非目标 exec 形状只 next，不构造任何 I/O", async () => {
  assert.deepEqual(contributionOperations(execShape("read", { file_path: "x" })), []);
  assert.deepEqual(contributionOperations(execShape("github", { method: "GET", path: "repos/o/r/pulls" })), []);
  const guard = createContributionGuard({ execFileImpl: fakeExec(), api: fakeApi({}) });
  const next = nextSpy();
  assert.equal(await guard(execShape("read", { file_path: "x" }), next), "next-result");
  assert.equal(next.calls, 1);
});
