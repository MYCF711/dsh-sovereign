import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import * as upstreamCore from "./check-pr-attribution.mjs";

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const EXEC_TIMEOUT = 30_000;

function deny(reason) {
  return { kind: "deny", reason };
}

/** Split only at unquoted shell statement boundaries; quoted # messages stay intact. */
export function splitShellStatements(command) {
  const statements = [];
  let quote = "";
  let start = 0;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      if (char === quote) quote = "";
      else if ((char === "\\" && quote === '"') || char === "`") index += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === ";" || char === "\n" || char === "|" || (char === "&" && command[index + 1] === "&")) {
      statements.push(command.slice(start, index));
      if (char === "|" && command[index + 1] === "|") index += 1;
      if (char === "&") index += 1;
      start = index + 1;
    }
  }
  statements.push(command.slice(start));
  return statements.map((item) => item.trim()).filter(Boolean);
}

/** Minimal shell-word reader for git/gh arguments; no shell is ever launched. */
export function shellWords(statement) {
  const words = [];
  let word = "";
  let quote = "";
  let started = false;
  for (let index = 0; index < statement.length; index += 1) {
    const char = statement[index];
    if (quote) {
      if (char === quote) {
        quote = "";
        started = true;
      } else if ((char === "\\" && quote === '"' && statement[index + 1] === '"') || char === "`") {
        word += statement[index + 1] || "";
        index += 1;
      } else {
        word += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started || word) words.push(word);
      word = "";
      started = false;
    } else {
      word += char;
      started = true;
    }
  }
  if (started || word) words.push(word);
  return words;
}

function optionValue(words, index, names) {
  const word = words[index] || "";
  for (const name of names) {
    if (word === name) return { value: words[index + 1], next: index + 1 };
    if (word.startsWith(name + "=")) return { value: word.slice(name.length + 1), next: index };
  }
  return null;
}

function ghOperation(words, cwd) {
  if (!/^gh(?:\.exe)?$/i.test(words[0] || "") || words[1] !== "pr") return null;
  const action = words[2];
  if (action !== "merge" && action !== "create") return null;
  const operation = { type: action, cwd, repo: "", base: "", head: "" };
  if (action === "merge") {
    operation.pr = Number(words[3]);
    if (!Number.isInteger(operation.pr) || operation.pr <= 0) return null;
  }
  for (let index = 3; index < words.length; index += 1) {
    const repo = optionValue(words, index, ["--repo", "-R"]);
    if (repo) {
      operation.repo = repo.value || "";
      index = repo.next;
      continue;
    }
    if (action === "create") {
      const base = optionValue(words, index, ["--base", "-B"]);
      if (base) {
        operation.base = base.value || "";
        index = base.next;
        continue;
      }
      const head = optionValue(words, index, ["--head", "-H"]);
      if (head) {
        operation.head = head.value || "";
        index = head.next;
      }
    }
  }
  return operation;
}

function gitOperation(words, cwd) {
  if (!/^git(?:\.exe)?$/i.test(words[0] || "") || words[1] !== "commit") return null;
  const operation = { type: "commit", cwd, messages: [], files: [] };
  for (let index = 2; index < words.length; index += 1) {
    const message = optionValue(words, index, ["--message", "-m"]);
    if (message) {
      operation.messages.push(message.value || "");
      index = message.next;
      continue;
    }
    if (words[index].startsWith("-m") && words[index].length > 2) {
      operation.messages.push(words[index].slice(2));
      continue;
    }
    const file = optionValue(words, index, ["--file", "-F"]);
    if (file) {
      operation.files.push(file.value || "");
      index = file.next;
      continue;
    }
    if (words[index].startsWith("-F") && words[index].length > 2) {
      operation.files.push(words[index].slice(2));
    }
  }
  return operation;
}

function githubOperation(exec, cwd) {
  const args = exec.arguments || {};
  const method = String(args.method || "GET").toUpperCase();
  const path = String(args.path || "").replace(/^\/+/, "").split("?")[0];
  let match = path.match(/^repos\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pulls\/(\d+)\/merge$/);
  if (method === "PUT" && match) return { type: "merge", cwd, repo: match[1], pr: Number(match[2]) };
  match = path.match(/^repos\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pulls$/);
  if (method !== "POST" || !match) return null;
  let body = args.body || {};
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  return {
    type: "create",
    cwd,
    repo: match[1],
    base: typeof body.base === "string" ? body.base : "",
    head: typeof body.head === "string" ? body.head : "",
  };
}

/** Return only operations covered by this gate. Everything else has zero I/O. */
export function contributionOperations(exec) {
  const args = exec?.arguments || {};
  const cwd = args.workdir || args.cwd || undefined;
  if (exec?.name === "github") {
    const operation = githubOperation(exec, cwd);
    return operation ? [operation] : [];
  }
  if (exec?.name !== "bash" && exec?.name !== "pwsh") return [];
  if (typeof args.command !== "string" || !args.command) return [];
  const operations = [];
  for (const statement of splitShellStatements(args.command)) {
    const words = shellWords(statement);
    const operation = gitOperation(words, cwd) || ghOperation(words, cwd);
    if (operation) operations.push(operation);
  }
  return operations;
}

function reasonFor(action, result) {
  const details = (result.failures || []).map((failure) => {
    if (failure.type === "shared-commit") {
      return `共享提交 ${failure.short || String(failure.sha).slice(0, 7)}（作者 @${failure.author}）`
        + `已在原 PR #${failure.originalPr}：应回 PR #${failure.originalPr}`;
    }
    if (failure.type === "missing-coauthor") {
      return `提交信息引用 #${failure.ref}，外部贡献者 @${failure.login} 提供了代码：`
        + `缺少 Co-authored-by: ${failure.login}`;
    }
    return failure.type || "未知归因问题";
  });
  const suffix = details.some((item) => item.includes("Co-authored-by"))
    ? "；补齐 Co-authored-by，或对误报写 Attribution-Skip: @<login> #<N>"
    : "";
  return `${action} 贡献归属检查未通过：${details.join("；") || "未知归因问题"}${suffix}`;
}

export function createContributionGuard(options = {}) {
  const core = options.core || upstreamCore;
  const execFileImpl = options.execFileImpl || execFile;
  const readFileImpl = options.readFileImpl || readFile;
  const env = options.env || process.env;
  const token = options.token || env.GH_TOKEN || env.GITHUB_TOKEN || "";
  const ghEnv = { ...env, ...(token ? { GH_TOKEN: token } : {}) };
  const gitEnv = { ...env };
  delete gitEnv.GH_TOKEN;
  delete gitEnv.GITHUB_TOKEN;

  const run = (file, args, runEnv, cwd) => new Promise((resolve, reject) => {
    execFileImpl(file, args, {
      encoding: "utf8",
      env: runEnv,
      ...(cwd ? { cwd } : {}),
      windowsHide: true,
      timeout: EXEC_TIMEOUT,
      maxBuffer: 16 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
      } else resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
  const runGit = (args, cwd) => run("git", args, gitEnv, cwd);
  const runGh = (args, cwd) => run("gh", args, ghEnv, cwd);
  const coreOptions = {
    env,
    token,
    execFileImpl,
    ...(options.api ? { api: options.api } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  };

  const resolveRepo = async (repo, cwd) => {
    if (repo) {
      if (!REPO_PATTERN.test(repo)) throw new Error(`仓库格式应为 owner/name：${repo}`);
      return repo;
    }
    const { stdout } = await runGh(["repo", "view", "--json", "nameWithOwner"], cwd);
    const resolved = JSON.parse(stdout)?.nameWithOwner;
    if (!REPO_PATTERN.test(resolved || "")) throw new Error("gh repo view 未返回 nameWithOwner");
    return resolved;
  };
  const resolveBase = async (repo, base, cwd) => {
    if (base) return base;
    const { stdout } = await runGh(["repo", "view", repo, "--json", "defaultBranchRef"], cwd);
    const resolved = JSON.parse(stdout)?.defaultBranchRef?.name;
    if (!resolved) throw new Error("gh repo view 未返回默认分支；请显式提供 --base");
    return resolved;
  };

  const checkCommit = async (operation) => {
    const messages = [...operation.messages];
    for (const file of operation.files) {
      if (file === "-") return null;
      messages.push(await readFileImpl(file, "utf8"));
    }
    const message = messages.join("\n\n");
    if (core.referencedNumbers(message).length === 0) return null;
    let mergeHead = "";
    try {
      mergeHead = (await runGit(["rev-parse", "--verify", "-q", "MERGE_HEAD"], operation.cwd)).stdout.trim();
    } catch {
      // A missing MERGE_HEAD is the ordinary non-merge path. Repository/API
      // failures still fail closed when gh resolves the repository below.
    }
    if (mergeHead) return null;
    const repo = await resolveRepo("", operation.cwd);
    const result = await core.checkCommitAttribution({ repo, message, ...coreOptions });
    return result.status === "FAIL" ? deny(reasonFor("git commit", result)) : null;
  };

  const checkMerge = async (operation) => {
    const repo = await resolveRepo(operation.repo, operation.cwd);
    const result = await core.checkAttribution({ repo, pr: operation.pr, ...coreOptions });
    return result.status === "FAIL" ? deny(reasonFor(`PR #${operation.pr} merge`, result)) : null;
  };

  const checkCreate = async (operation) => {
    const repo = await resolveRepo(operation.repo, operation.cwd);
    const base = await resolveBase(repo, operation.base, operation.cwd);
    const head = operation.head.includes(":") ? operation.head.split(":").at(-1) : (operation.head || "HEAD");
    const mergeBase = (await runGit(["merge-base", head, base], operation.cwd)).stdout.trim().split(/\s+/)[0];
    if (!mergeBase) throw new Error(`git merge-base ${head} ${base} 未返回 SHA`);
    const { stdout } = await runGit(
      ["log", "--no-merges", "--format=%H", `${mergeBase}..${head}`],
      operation.cwd,
    );
    const shas = stdout.split(/\s+/).map((item) => item.trim()).filter(Boolean);
    if (shas.length === 0) return null;
    const result = await core.checkBranchAttribution({ repo, shas, ...coreOptions });
    return result.status === "FAIL" ? deny(reasonFor("PR create", result)) : null;
  };

  return async (exec, next) => {
    const operations = contributionOperations(exec);
    if (operations.length === 0) return next();
    try {
      for (const operation of operations) {
        const decision = operation.type === "commit"
          ? await checkCommit(operation)
          : operation.type === "merge"
            ? await checkMerge(operation)
            : await checkCreate(operation);
        if (decision) return decision;
      }
      return next();
    } catch (error) {
      const detail = core.redactSecret(error?.message || String(error), token)
        .trim().replace(/\s*\n\s*/g, " ");
      return deny(
        `贡献归属检查失败：${detail || "未知错误"}。`
        + "检查 gh auth status、仓库访问权限及本地 git base/head 后重试；API/本地判据失败时不会放行。",
      );
    }
  };
}

export function armContributionGuard(ctx, options = {}) {
  return ctx.on("tools/pre-execute", createContributionGuard(options));
}
