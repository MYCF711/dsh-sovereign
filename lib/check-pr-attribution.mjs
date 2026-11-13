#!/usr/bin/env node
// Source snapshot: https://github.com/MYCF711/dsh-session-superagent
// Source commit: 4b475f8c4ac43a45ed27018731f0850fb900f89f
// Upstream body SHA256: ee06cf2110fbc2f43051e9594fd37ceb99e39a64623eb46d22eb2b74ea446771
// === BEGIN UPSTREAM BODY (byte-identical; additive exports follow the end marker) ===
// 归因门禁：把别人的提交并进自己的 PR 时，必须保留原作者署名，并指回原 PR。
//
// 两类判据（都只看**非 merge** 提交；merge 提交整条跳过 —— 合并不产生新的归属）：
//
//   ① 共享提交 —— 当前 PR 里某个提交的作者不是当前 PR 作者，而另一个 PR
//      （--against 指定的原 PR；未指定时枚举开放 PR 的提交）
//      的作者正是该提交作者。这等于「把别人的提交原样搬进了自己的 PR」，
//      必须指回原 PR，而不是静默丢署名。
//
//   ② Issue 代码引用 —— 提交信息里写了 #N，且 #N 是 issue（不是 PR）、
//      其正文 / 评论里出现了**外部贡献者**（author_association 不是
//      OWNER / MEMBER）贴的 ```diff / ```js / ```javascript / ```ts 代码。
//      这时代码是对方给的，必须带该 login 的 Co-authored-by；
//      确认是误报时，写一行 `Attribution-Skip: @login #N` 显式放行。
//
// 用法：
//   node scripts/check-pr-attribution.mjs --pr 49 --against 41 --repo owner/name
//   GH_TOKEN=... node scripts/check-pr-attribution.mjs --pr 43 --repo owner/name
//
// 退出码：PASS 0 / FAIL 1 / 无 PR 上下文 SKIP 0 / 用法或 API 错误 2。
// 凭证：只读 GH_TOKEN / GITHUB_TOKEN；默认经 gh 环境传递，注入 fetch 时只进 Authorization 头。
//
// 零依赖：只 import node 内置模块；CLI 默认走 gh api，测试可注入 api / fetchImpl / execFileImpl。
import { execFile } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const API = 'https://api.github.com'
const PRIVILEGED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER'])
const CODE_FENCE_OPEN = /^[ \t]*```[ \t]*(diff|js|javascript|ts)\b.*$/i
const CODE_FENCE_CLOSE = /^[ \t]*```[ \t]*$/
const SOURCE_LOCATION = /^[`'\"([{（【\s]*[A-Za-z0-9_@./\\-]+\.(?:js|mjs|ts)(?::\d+(?:-\d+)?|#L\d+(?:-L\d+)?)?/i
const CONTRIBUTION_CONTEXT = /改法|建议|修复|替换|可以改成|可改成|实现方案|解决方案|修改方案|改为|改成|补丁|\b(?:solution|patch|fix|replace|replacement|recommend(?:ation)?|proposed\s+(?:change|fix)|implementation\s+plan)\b/i
const ATTRIBUTION_SKIP = /^[ \t]*Attribution-Skip:[ \t]*@?([A-Za-z0-9][A-Za-z0-9-]*)[ \t]+#(\d+)[ \t]*$/gim
const CO_AUTHOR = /^[ \t]*Co-authored-by:[ \t]*(.+?)[ \t]*$/gim
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

export const USAGE = [
  '用法：',
  '  node scripts/check-pr-attribution.mjs --pr <当前PR> [--against <原PR>] --repo <owner/name>',
  '',
  '判据：',
  '  ① 共享提交  非 merge 提交的作者不是当前 PR 作者，而原 PR 的作者正是该提交作者',
  '              → FAIL，并输出「应回 PR #M」。',
  '  ② 代码引用  提交信息引用 #N，且 #N 是 issue、其正文/评论里有外部贡献者',
  '              贴的 ```diff / ```js / ```javascript / ```ts 代码',
  '              → 该提交必须带对应 login 的 Co-authored-by，',
  '                或写一行 `Attribution-Skip: @login #N` 显式放行。',
  '',
  '退出码：PASS 0 / FAIL 1 / 无 PR 上下文 SKIP 0 / 用法或 API 错误 2。',
  '凭证：只读 GH_TOKEN / GITHUB_TOKEN；默认经 gh 环境传递，不进 argv，错误里脱敏。',
].join('\n')

/** 用法错误（参数形状不对）。 */
export class UsageError extends Error {
  constructor(message) {
    super(message)
    this.name = 'UsageError'
  }
}

/** GitHub API 调用失败。message 已经脱敏，可以安全打印。 */
export class ApiError extends Error {
  constructor(message, { status = 0, path = '', cause } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.path = path
    if (cause) this.cause = cause
  }
}

/** 把 token 与常见凭证形态从文本里抹掉 —— 错误信息会进日志，不能带凭证。 */
export function redactSecret(text, token = '') {
  let value = String(text ?? '')
  if (token) value = value.split(token).join('***')
  return value.replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '***')
}

/** 解析 `--pr N --against M --repo owner/name`。未知参数一律报错，不静默忽略。 */
export function parseArgs(argv = []) {
  const parsed = { pr: null, against: null, repo: null, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      parsed.help = true
      continue
    }
    if (arg === '--pr' || arg === '--against' || arg === '--repo') {
      const value = argv[index + 1]
      if (value == null || value === '') throw new UsageError(`${arg} 缺少值`)
      index += 1
      if (arg === '--repo') {
        if (!REPO_PATTERN.test(value)) throw new UsageError(`--repo 必须是 owner/name：${value}`)
        parsed.repo = value
      } else {
        const number = Number(value)
        if (!Number.isInteger(number) || number <= 0) throw new UsageError(`${arg} 必须是正整数：${value}`)
        parsed[arg.slice(2)] = number
      }
      continue
    }
    throw new UsageError(`未知参数：${arg}`)
  }
  return parsed
}

/** 提交信息里引用的 #N（去重；`C#11` 这种不算，`（#39）`、`PR #49` 算）。 */
export function referencedNumbers(message) {
  const numbers = new Set()
  const pattern = /(^|[^\w#&])#(\d+)(?!\d)/g
  for (const match of String(message || '').matchAll(pattern)) numbers.add(Number(match[2]))
  return [...numbers]
}

/** `Attribution-Skip: @login #N` 例外声明（区分 login 与 ref，不能跨引用放行）。 */
export function parseAttributionSkips(message) {
  const skips = []
  for (const match of String(message || '').matchAll(ATTRIBUTION_SKIP)) {
    skips.push({ login: match[1], ref: Number(match[2]) })
  }
  return skips
}

/** 从 Co-authored-by 尾注里取 login：认 name、email 本地部分、以及 123+login 形态。 */
export function coAuthorLogins(message) {
  const logins = new Set()
  for (const match of String(message || '').matchAll(CO_AUTHOR)) {
    const value = match[1].trim()
    const email = value.match(/<([^>]*)>/)?.[1]?.trim() || ''
    const name = value.replace(/<[^>]*>/, '').trim()
    for (const candidate of [name, email.split('@')[0]]) {
      const login = candidate.replace(/^\d+\+/, '').trim()
      if (login) logins.add(login.toLowerCase())
    }
  }
  return logins
}

/** 围栏自身、前两条非空行或最近 Markdown 节标题必须给出明确贡献语境。 */
function hasContributionContext(lines, index) {
  const context = [lines[index]]
  let nearby = 0
  for (let cursor = index - 1; cursor >= 0 && nearby < 2; cursor -= 1) {
    const line = lines[cursor].trim()
    if (CODE_FENCE_CLOSE.test(line) || CODE_FENCE_OPEN.test(line)) break
    if (line) {
      context.push(line)
      nearby += 1
    }
  }
  for (let cursor = index - 1, scanned = 0; cursor >= 0 && scanned < 20; cursor -= 1, scanned += 1) {
    const line = lines[cursor].trim()
    if (CODE_FENCE_CLOSE.test(line) || CODE_FENCE_OPEN.test(line)) break
    if (/^#{1,6}\s+/.test(line)) {
      context.push(line)
      break
    }
  }
  return CONTRIBUTION_CONTEXT.test(context.join('\n'))
}

/**
 * 逐块判断是否有贡献代码：diff 总是候选；js / javascript / ts 除了不能是
 * 源码定位后的现状引用，还必须在有限上文里有改法 / 建议 / solution / patch 等语境。
 * 普通复现块不署名；同一正文里另有明确改法块时仍必须署名。
 */
export function hasCodeBlock(text) {
  const lines = String(text || '').split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const opening = lines[index].match(CODE_FENCE_OPEN)
    if (!opening) continue
    const language = opening[1].toLowerCase()
    let previousIndex = index - 1
    while (previousIndex >= 0 && !lines[previousIndex].trim()) previousIndex -= 1
    const previousLine = (lines[previousIndex] || '').trim()
    const sourceQuote = SOURCE_LOCATION.test(previousLine)
    if (language === 'diff' || (!sourceQuote && hasContributionContext(lines, index))) return true
    // 非贡献块整块跳过，避免把块内的字符串误认成新围栏。
    while (index + 1 < lines.length && !CODE_FENCE_CLOSE.test(lines[index + 1])) index += 1
    index += 1
  }
  return false
}

/** OWNER / MEMBER 是仓库自己人，不要求互相署名。 */
export function isPrivilegedAssociation(association) {
  return PRIVILEGED_ASSOCIATIONS.has(String(association || '').toUpperCase())
}

/** merge 提交（父提交 > 1 个）不参与归因判定。 */
export function isMergeCommit(commit) {
  return Array.isArray(commit?.parents) && commit.parents.length > 1
}

function sameLogin(left, right) {
  const first = String(left || '').trim().toLowerCase()
  const second = String(right || '').trim().toLowerCase()
  return Boolean(first) && first === second
}

function commitLogin(commit) {
  return commit?.author?.login || null
}

function shortSha(sha) {
  return String(sha || '').slice(0, 7)
}

async function readResponseBody(response) {
  if (typeof response?.text === 'function') {
    const text = await response.text()
    if (!text) return null
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  if (typeof response?.json === 'function') return response.json()
  return null
}

/** 从 gh 的 stderr 提取 HTTP 状态；执行错误没有 HTTP 状态时返回 0。 */
export function ghErrorStatus(text) {
  const value = String(text || '')
  const match = value.match(/\bHTTP\s*(\d{3})\b/i)
    || value.match(/\bstatus(?:\s+code)?\s*[:=]?\s*(\d{3})\b/i)
  return match ? Number(match[1]) : 0
}

/**
 * 用本机 gh 的登录态请求 API，并适配成 fetch 的 Response-like 形状。
 * token 只放子进程环境；argv 固定为 `gh api <path>`，错误文本也会脱敏。
 */
export async function ghApiResponse(path, options = {}) {
  const execFileImpl = options.execFileImpl || execFile
  const env = options.env || process.env
  const token = options.token || ''
  const timeout = options.timeout || 30_000
  try {
    const { stdout } = await new Promise((resolve, reject) => {
      execFileImpl('gh', ['api', path], {
        encoding: 'utf8',
        env: { ...env, ...(token ? { GH_TOKEN: token } : {}) },
        windowsHide: true,
        timeout,
        maxBuffer: 16 * 1024 * 1024,
      }, (error, stdout, stderr) => {
        if (error) reject({ error, stderr })
        else resolve({ stdout, stderr })
      })
    })
    return { ok: true, status: 200, text: async () => String(stdout || '') }
  } catch (failure) {
    const error = failure?.error || failure
    const stderr = failure?.stderr || error?.stderr || ''
    const reason = error?.message || String(error)
    const detail = redactSecret(String(stderr || reason), token).trim().replace(/\s*\n\s*/g, ' ')
    const status = ghErrorStatus(`${stderr}\n${reason}`)
    return {
      ok: false,
      status,
      text: async () => JSON.stringify({ message: detail || 'gh api failed' }),
    }
  }
}

async function apiJson(path, context) {
  const { token = '', fetchImpl, api } = context
  if (api) {
    try {
      return await api(path)
    } catch (error) {
      if (error instanceof ApiError) throw error
      const reason = redactSecret(error?.message || String(error), token)
      throw new ApiError(`请求 ${path} 失败：${reason}`, { path, cause: error })
    }
  }
  let response
  try {
    response = fetchImpl
      ? await fetchImpl(API + path, {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'dsh-pr-attribution-gate',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      })
      : await ghApiResponse(path, context)
  } catch (error) {
    const reason = redactSecret(error?.message || String(error), token)
    throw new ApiError(`请求 ${path} 失败：${reason}`, { path, cause: error })
  }
  const body = await readResponseBody(response)
  if (!response?.ok) {
    const status = Number(response?.status) || 0
    const detail = body && typeof body === 'object' && body.message
      ? `：${redactSecret(body.message, token)}`
      : ''
    throw new ApiError(`HTTP ${status} ${path}${detail}`, { status, path })
  }
  return body
}

async function getPullRequest(repo, number, context) {
  const path = `/repos/${repo}/pulls/${number}`
  const pull = await apiJson(path, context)
  if (!pull || typeof pull !== 'object' || Array.isArray(pull)) {
    throw new ApiError(`读取 PR #${number} 失败：返回不是对象`, { path })
  }
  return pull
}

/** 列表接口统一按 100 条一页翻到底（PR 提交 / issue 评论都走这里）。 */
async function getPaged(repo, path, context) {
  const items = []
  for (let page = 1; page <= 10; page += 1) {
    const separator = path.includes('?') ? '&' : '?'
    const batch = await apiJson(`${path}${separator}per_page=100&page=${page}`, context)
    if (!Array.isArray(batch)) {
      throw new ApiError(`读取 ${path} 失败：返回不是数组`, { path })
    }
    items.push(...batch)
    if (batch.length < 100) break
  }
  return items
}

function getPullRequestCommits(repo, number, context) {
  return getPaged(repo, `/repos/${repo}/pulls/${number}/commits`, context)
}

function getIssue(repo, number, context) {
  return apiJson(`/repos/${repo}/issues/${number}`, context)
}

function getIssueComments(repo, number, context) {
  return getPaged(repo, `/repos/${repo}/issues/${number}/comments`, context)
}

/** issue 正文 + 评论里，哪些外部 login 贴了代码。 */
function requiredLogins(issue, comments) {
  const required = new Map()
  const sources = [
    { login: issue?.user?.login, association: issue?.author_association, body: issue?.body },
    ...comments.map((comment) => ({
      login: comment?.user?.login,
      association: comment?.author_association,
      body: comment?.body,
    })),
  ]
  for (const source of sources) {
    if (!source.login || isPrivilegedAssociation(source.association)) continue
    if (!hasCodeBlock(source.body)) continue
    required.set(source.login.toLowerCase(), source.login)
  }
  return [...required.values()]
}

function normalizeContext(options) {
  const api = options.api || null
  const fetchImpl = options.fetchImpl || null
  const execFileImpl = options.execFileImpl || execFile
  const env = options.env || process.env
  if (api && typeof api !== 'function') throw new UsageError('api 必须是函数')
  if (!api && fetchImpl && typeof fetchImpl !== 'function') throw new UsageError('fetchImpl 必须是函数')
  if (!api && !fetchImpl && typeof execFileImpl !== 'function') throw new UsageError('execFileImpl 必须是函数')
  const token = options.token || env.GH_TOKEN || env.GITHUB_TOKEN || ''
  return { token, fetchImpl, api, execFileImpl, env }
}

/**
 * 跑完整归因检查。返回结构稳定，测试直接断言：
 *   { status: 'PASS' | 'FAIL' | 'SKIP', exitCode, failures, passed, skipped, ... }
 * API 失败时抛 ApiError（message 已脱敏），由调用方决定退出码。
 */
export async function checkAttribution(options = {}) {
  const { repo, pr, against = null } = options
  if (pr == null) {
    return {
      status: 'SKIP',
      exitCode: 0,
      reason: 'no-pr-context',
      repo: repo || null,
      pr: null,
      against: against ?? null,
      commitCount: 0,
      failures: [],
      passed: [],
      skipped: [],
    }
  }
  if (!repo) throw new UsageError('缺少 --repo owner/name')
  const context = normalizeContext(options)
  const failures = []
  const passed = []
  const skipped = []

  const current = await getPullRequest(repo, pr, context)
  const currentAuthor = current?.user?.login || ''
  const commits = await getPullRequestCommits(repo, pr, context)
  for (const commit of commits) {
    if (isMergeCommit(commit)) skipped.push({ type: 'merge', sha: commit.sha })
  }
  const plainCommits = commits.filter((commit) => !isMergeCommit(commit))
  // A 只比较单父提交；B 则处理所有非 merge 提交。
  const sharedCandidates = plainCommits.filter((commit) => commit?.parents?.length === 1)

  // ① 共享提交：别人的提交被并进当前 PR 时，要指回原 PR。
  if (against != null) {
    const original = await getPullRequest(repo, against, context)
    const originalAuthor = original?.user?.login || ''
    const originalCommits = await getPullRequestCommits(repo, against, context)
    const originalShas = new Set(
      originalCommits.filter((commit) => commit?.parents?.length === 1).map((commit) => commit.sha),
    )
    for (const commit of sharedCandidates) {
      const author = commitLogin(commit)
      if (!author) {
        skipped.push({ type: 'unlinked-author', sha: commit.sha })
        continue
      }
      if (sameLogin(author, currentAuthor)) {
        passed.push({ type: 'own-commit', sha: commit.sha, login: author })
        continue
      }
      if (!originalShas.has(commit.sha)) {
        passed.push({ type: 'external-new', sha: commit.sha, login: author })
        continue
      }
      if (!sameLogin(author, originalAuthor)) {
        skipped.push({ type: 'shared-other-author', sha: commit.sha })
        continue
      }
      failures.push({
        type: 'shared-commit',
        sha: commit.sha,
        short: shortSha(commit.sha),
        author,
        originalPr: original.number,
        originalAuthor,
      })
    }
  } else {
    // commits/{sha}/pulls 对重复 PR 可能返回空；默认改为枚举开放 PR 的提交。
    // 全部提交都是当前作者时不请求开放列表，避免常见路径多花 API。
    const hasExternalCommit = plainCommits.some((commit) => {
      const author = commitLogin(commit)
      return author && !sameLogin(author, currentAuthor)
    })
    const pullsBySha = new Map()
    if (hasExternalCommit) {
      const openPulls = await getPaged(repo, `/repos/${repo}/pulls?state=open`, context)
      for (const other of openPulls) {
        if (Number(other?.number) === Number(current.number || pr)) continue
        const otherCommits = await getPullRequestCommits(repo, other.number, context)
        for (const otherCommit of otherCommits) {
          if (otherCommit?.parents?.length !== 1 || !otherCommit?.sha) continue
          const related = pullsBySha.get(otherCommit.sha) || []
          related.push(other)
          pullsBySha.set(otherCommit.sha, related)
        }
      }
    }
    for (const commit of sharedCandidates) {
      const author = commitLogin(commit)
      if (!author) {
        skipped.push({ type: 'unlinked-author', sha: commit.sha })
        continue
      }
      if (sameLogin(author, currentAuthor)) {
        passed.push({ type: 'own-commit', sha: commit.sha, login: author })
        continue
      }
      const related = pullsBySha.get(commit.sha) || []
      const original = related.find((item) => sameLogin(item?.user?.login, author))
      if (!original) {
        passed.push({ type: 'external-new', sha: commit.sha, login: author })
        continue
      }
      failures.push({
        type: 'shared-commit',
        sha: commit.sha,
        short: shortSha(commit.sha),
        author,
        originalPr: original.number,
        originalAuthor: original.user.login,
      })
    }
  }

  // ② issue 代码引用：代码是外部贡献者给的，提交必须带上对方的 Co-authored-by。
  const issueCache = new Map()
  for (const commit of plainCommits) {
    const message = commit?.commit?.message || ''
    for (const ref of referencedNumbers(message)) {
      let record = issueCache.get(ref)
      if (!record) {
        const issue = await getIssue(repo, ref, context)
        const comments = issue?.pull_request ? [] : await getIssueComments(repo, ref, context)
        record = { issue, comments }
        issueCache.set(ref, record)
      }
      if (record.issue?.pull_request) {
        skipped.push({ type: 'pr-reference', ref, sha: commit.sha })
        continue
      }
      const required = requiredLogins(record.issue, record.comments)
      if (required.length === 0) {
        passed.push({ type: 'issue-no-code', ref, sha: commit.sha })
        continue
      }
      const coAuthors = coAuthorLogins(message)
      const skips = parseAttributionSkips(message)
      for (const login of required) {
        if (skips.some((skip) => skip.ref === ref && sameLogin(skip.login, login))) {
          skipped.push({ type: 'attribution-skip', ref, login, sha: commit.sha })
          continue
        }
        if (coAuthors.has(login.toLowerCase())) {
          passed.push({ type: 'co-author', ref, login, sha: commit.sha })
          continue
        }
        failures.push({
          type: 'missing-coauthor',
          sha: commit.sha,
          short: shortSha(commit.sha),
          ref,
          login,
        })
      }
    }
  }

  const status = failures.length > 0 ? 'FAIL' : 'PASS'
  return {
    status,
    exitCode: status === 'FAIL' ? 1 : 0,
    repo,
    pr,
    against: against ?? null,
    currentAuthor,
    commitCount: commits.length,
    failures,
    passed,
    skipped,
  }
}

// 语义化别名，便于调用方按脚本名导入；主实现仍保留短名兼容现有集成。
export { checkAttribution as checkPrAttribution }

/** 给人看的结论；FAIL 时必须带「应回 PR #M」或具体缺哪个 login。 */
export function formatResult(result) {
  if (!result || result.status === 'SKIP') {
    return 'SKIP 无 PR 上下文（缺少 --pr N）：未执行归因检查'
  }
  const lines = []
  if (result.status === 'FAIL') {
    lines.push(`FAIL PR #${result.pr} 归因不完整（${result.failures.length} 项）：`)
    for (const failure of result.failures) {
      if (failure.type === 'shared-commit') {
        lines.push(
          `  - 共享提交 ${failure.short}（作者 @${failure.author}）已在原 PR #${failure.originalPr}`
          + `（作者 @${failure.originalAuthor}）中：应回 PR #${failure.originalPr}`,
        )
      } else if (failure.type === 'missing-coauthor') {
        lines.push(
          `  - 提交 ${failure.short} 引用 #${failure.ref}（外部贡献者 @${failure.login} 贴了代码）：`
          + `缺少 Co-authored-by: ${failure.login}`,
        )
      } else {
        lines.push(`  - ${failure.type}：${failure.short || failure.sha || ''}`)
      }
    }
    lines.push('  修法：补 `Co-authored-by: <login> <email>`；确认是误报时写 `Attribution-Skip: @<login> #<N>`。')
    return lines.join('\n')
  }
  lines.push(
    `PASS PR #${result.pr} 归因检查通过（${result.commitCount} 个提交：`
    + `${result.passed.length} 项放行 / ${result.skipped.length} 项跳过）`,
  )
  return lines.join('\n')
}

/** CLI 主体：默认 gh api；可注入 api / fetchImpl / execFileImpl，测试完全离线。 */
export async function runCli(argv = [], options = {}) {
  const log = options.log || ((line) => console.log(line))
  const errorLog = options.errorLog || ((line) => console.error(line))
  const env = options.env || process.env
  const token = env.GH_TOKEN || env.GITHUB_TOKEN || ''
  let parsed
  try {
    parsed = parseArgs(argv)
  } catch (error) {
    errorLog(`ERROR ${redactSecret(error?.message || String(error), token)}`)
    return 2
  }
  if (parsed.help) {
    log(USAGE)
    return 0
  }
  if (parsed.pr == null) {
    log('SKIP 无 PR 上下文（缺少 --pr N）：未执行归因检查')
    return 0
  }
  try {
    const result = await checkAttribution({
      ...parsed,
      token,
      env,
      api: options.api,
      fetchImpl: options.fetchImpl,
      execFileImpl: options.execFileImpl,
    })
    log(formatResult(result))
    return result.exitCode
  } catch (error) {
    errorLog(`ERROR ${redactSecret(error?.message || String(error), token)}`)
    return 2
  }
}

const INVOKED_AS_SCRIPT = typeof process.argv[1] === 'string'
  && import.meta.url === pathToFileURL(process.argv[1]).href
if (INVOKED_AS_SCRIPT) {
  const code = await runCli(process.argv.slice(2))
  if (code === 1) process.exitCode = 1
  else if (code !== 0) process.exitCode = code
}
// === END UPSTREAM BODY ===

// Additive integration helpers only. The upstream body above is byte-identical;
// these helpers call its existing issue/shared-commit predicates without changing
// checkAttribution, its CLI, or any established result.
/** Check one pending `git commit` message with the upstream issue criterion. */
export async function checkCommitAttribution(options = {}) {
  const { repo, message = '' } = options
  if (!repo) throw new UsageError('缺少 repo owner/name')
  const failures = []
  const passed = []
  const skipped = []
  const refs = referencedNumbers(message)
  if (refs.length > 0) {
    const context = normalizeContext(options)
    const coAuthors = coAuthorLogins(message)
    const skips = parseAttributionSkips(message)
    for (const ref of refs) {
      const issue = await getIssue(repo, ref, context)
      const comments = issue?.pull_request ? [] : await getIssueComments(repo, ref, context)
      if (issue?.pull_request) {
        skipped.push({ type: 'pr-reference', ref, sha: null })
        continue
      }
      const required = requiredLogins(issue, comments)
      if (required.length === 0) {
        passed.push({ type: 'issue-no-code', ref, sha: null })
        continue
      }
      for (const login of required) {
        if (skips.some((skip) => skip.ref === ref && sameLogin(skip.login, login))) {
          skipped.push({ type: 'attribution-skip', ref, login, sha: null })
        } else if (coAuthors.has(login.toLowerCase())) {
          passed.push({ type: 'co-author', ref, login, sha: null })
        } else {
          failures.push({ type: 'missing-coauthor', sha: null, short: 'pending', ref, login })
        }
      }
    }
  }
  const status = failures.length > 0 ? 'FAIL' : 'PASS'
  return {
    status,
    exitCode: status === 'FAIL' ? 1 : 0,
    repo,
    pr: null,
    commitCount: 0,
    failures,
    passed,
    skipped,
  }
}

/**
 * Check local, non-merge branch SHAs against open PR commits. The original PR
 * must be authored by the external commit author, exactly as in checkAttribution.
 */
export async function checkBranchAttribution(options = {}) {
  const { repo, currentUser = '' } = options
  if (!repo) throw new UsageError('缺少 repo owner/name')
  if (!Array.isArray(options.shas)) throw new UsageError('shas 必须是数组')
  const shas = [...new Set(options.shas.filter(Boolean).map(String))]
  const failures = []
  const passed = []
  const skipped = []
  if (shas.length > 0) {
    const context = normalizeContext(options)
    let login = String(currentUser || '').trim()
    if (!login) {
      const user = await apiJson('/user', context)
      login = String(user?.login || '').trim()
      if (!login) throw new ApiError('读取当前 gh 用户失败：/user 未返回 login', { path: '/user' })
    }
    const localShas = new Set(shas)
    const openPulls = await getPaged(repo, `/repos/${repo}/pulls?state=open`, context)
    const seen = new Set()
    for (const original of openPulls) {
      const originalAuthor = original?.user?.login || ''
      if (!originalAuthor || sameLogin(originalAuthor, login)) continue
      const originalCommits = await getPullRequestCommits(repo, original.number, context)
      for (const commit of originalCommits) {
        if (!localShas.has(commit?.sha)) continue
        if (isMergeCommit(commit) || commit?.parents?.length !== 1) {
          skipped.push({ type: 'merge', sha: commit.sha })
          continue
        }
        const author = commitLogin(commit)
        if (!author || sameLogin(author, login) || !sameLogin(author, originalAuthor)) continue
        const key = `${original.number}:${commit.sha}`
        if (seen.has(key)) continue
        seen.add(key)
        failures.push({
          type: 'shared-commit',
          sha: commit.sha,
          short: shortSha(commit.sha),
          author,
          originalPr: original.number,
          originalAuthor,
        })
      }
    }
    const failedShas = new Set(failures.map((failure) => failure.sha))
    for (const sha of shas) {
      if (!failedShas.has(sha) && !skipped.some((item) => item.sha === sha)) {
        passed.push({ type: 'no-shared-attribution', sha })
      }
    }
  }
  const status = failures.length > 0 ? 'FAIL' : 'PASS'
  return {
    status,
    exitCode: status === 'FAIL' ? 1 : 0,
    repo,
    pr: null,
    currentAuthor: currentUser || undefined,
    commitCount: shas.length,
    failures,
    passed,
    skipped,
  }
}
