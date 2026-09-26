import * as m from "../index.js";

// ---- test A: sanitizer must redact, and must NOT touch prose ----
const cases = [
  ["openai",   "key is sk-proj-AbCdEf0123456789GhIjKlMnOpQrStUvWxYz and done"],
  ["github",   "token ghp_0123456789abcdefABCDEF0123456789ab"],
  ["aws",      "AKIAIOSFODNN7EXAMPLE"],
  ["google",   "AIzaSyA1234567890abcdefghijklmnopqrstuv"],
  ["jwt",      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk"],
  ["pem",      "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKC\n-----END RSA PRIVATE KEY-----"],
  ["connstr",  "postgres://admin:hunter2secret@db.internal:5432/app"],
  ["dotenv",   "OPENAI_API_KEY=sk-abc123456789012345678"],
  ["yaml",     "  DB_PASSWORD: supersecretvalue"],
  ["bearer",   "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456"],
];
let pass=0, fail=0;
for (const [n, src] of cases) {
  const out = m.sanitizeText(src);
  const changed = out !== src;
  const tagged = /REDACTED/.test(out);
  if (changed && tagged) { pass++; console.log("  PASS " + n + " -> " + out.slice(0,72).replace(/\n/g,"\\n")); }
  else { fail++; console.log("  FAIL " + n + " (changed=" + changed + " tagged=" + tagged + ") -> " + out.slice(0,72)); }
}

// ---- test B: prose that merely mentions secrets must be untouched ----
const prose = [
  "Set your API key in the environment before running the tool.",
  "The token expired, so we refreshed it and retried the request.",
  "Use a strong password and store credentials in a secret manager.",
  "The password field is rendered as a masked input on the login page.",
];
for (const src of prose) {
  const out = m.sanitizeText(src);
  if (out === src) { pass++; console.log("  PASS prose-untouched: " + src.slice(0,56)); }
  else { fail++; console.log("  FAIL prose-MUTATED: " + src + " -> " + out); }
}
console.log("");
console.log("SANITIZER: pass=" + pass + " fail=" + fail);

