// INT-08 source fingerprint investigation: GET-only fetches and git show.
// Search known tracked commit tips for the source of files currently deployed.
// Safe: no Firebase credentials, no POST, no local Git changes.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const refs = [
  "main",
  "fix/c15-auditoria-completa",
  "fix/int06-rate-limit-idempotency",
  "fix/int07-integration-only-rc",
  "fix/int08-firebase-preflight",
  "9a042b771703ee527426ec5a54501f2155a8fcfa"
];

const files = [
  {
    endpoint: "https://painel.licencas.guiasys.online/assets/js/app.js",
    path: "assets/js/app.js"
  },
  {
    endpoint: "https://painel.licencas.guiasys.online/assets/js/entitlement-verifier.js",
    path: "assets/js/entitlement-verifier.js"
  },
  {
    endpoint: "https://painel.licencas.guiasys.online/assets/js/integration-contract-support.js",
    path: "assets/js/integration-contract-support.js"
  },
  {
    endpoint: "https://licencas.guiasys.online/assets/catalog.js",
    path: "public/assets/catalog.js"
  }
];
function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function atRef(ref, file) {
  try {
    return execFileSync("git", ["show", `${ref}:${file}`],
      { encoding: "buffer", maxBuffer: 8 * 1024 * 1024 });
  } catch {
    return null;
  }
}
function branchSha(ref) {
  try { return execFileSync("git", ["rev-parse", ref], { encoding: "utf8" }).trim(); }
  catch { return null; }
}
const report = { inspectedAt: new Date().toISOString(), matched: [], files: [] };
for (const item of files) {
  let status = null, deployedHash = null, error = null;
  try {
    const response = await fetch(item.endpoint, {
      method: "GET", cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(15000)
    });
    status = response.status;
    if (response.status === 200) {
      deployedHash = hash(Buffer.from(await response.arrayBuffer()));
    }
  } catch (ex) {
    error = String(ex.message || ex);
  }
  const versions = refs.map(ref => {
    const bytes = atRef(ref, item.path);
    if (!bytes) return { ref, sha: branchSha(ref), exists: false };
    const sha256 = hash(bytes);
    return { ref, sha: branchSha(ref), exists: true,
      sha256, matchesProduction: sha256 === deployedHash };
  });
  const matchingRefs = versions.filter(v => v.matchesProduction).map(v => v.ref);
  report.files.push({ endpoint: item.endpoint, path: item.path, status,
    deployedSha256: deployedHash, matchingRefs, versions, error });
  if (matchingRefs.length) report.matched.push({ path: item.path, matchingRefs });
}
console.log(JSON.stringify(report, null, 2));
// Diagnosis is informational: a deployed file not matching known refs does not
// indicate that Firebase is broken, only that another commit may be in use.
