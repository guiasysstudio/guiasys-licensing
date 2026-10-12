// INT-08.3: GET-only, no Firebase credentials, no mutation. Use after
// preflight to classify whether differences are minor or major.
// Print *only* byte counts/hash and git --numstat; never emit source contents.
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const admin = "https://painel.licencas.guiasys.online";
const store = "https://licencas.guiasys.online";
const items = [
  { base: admin, relative: "assets/js/app.js" },
  { base: admin, relative: "assets/js/entitlement-verifier.js" },
  { base: admin, relative: "assets/js/integration-contract-support.js" },
  { base: store, relative: "public/assets/catalog.js", remote: "assets/catalog.js" },
  { base: admin, relative: "assets/css/app.css" },
  { base: store, relative: "public/assets/catalog.css", remote: "assets/catalog.css" },
  { base: admin, relative: "index.html" },
  { base: store, relative: "public/index.html", remote: "index.html" }
];
const sha = value => createHash("sha256").update(value).digest("hex");
const temp = await mkdtemp(path.join(tmpdir(), "guiasys-int08-diff-"));
const report = [];
try {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const local = path.join(root, item.relative);
    const remotePath = item.remote || item.relative;
    const url = item.base + "/" + remotePath;
    let status = 0, deployedBytes = null, error = null, numstat = null;
    try {
      const response = await fetch(url, {
        method: "GET", redirect: "error", cache: "no-store",
        signal: AbortSignal.timeout(15000)
      });
      status = response.status;
      if (response.ok) deployedBytes = Buffer.from(await response.arrayBuffer());
      else error = "HTTP " + status;
    } catch (e) {
      error = String(e.message || e);
    }
    const localBytes = await readFile(local);
    if (deployedBytes !== null) {
      const copied = path.join(temp, "remote-" + i + path.extname(local));
      await writeFile(copied, deployedBytes);
      try {
        numstat = execFileSync("git", ["diff", "--no-index", "--numstat", "--", local, copied],
          { encoding: "utf8" }).trim().split("\t").slice(0, 2).join(" additions/deletions ");
      } catch (e) {
        numstat = String(e.stdout || "").trim().split("\t").slice(0, 2).join(" additions/deletions ");
      }
    }
    report.push({
      asset: item.relative, status,
      localBytes: localBytes.length, deployedBytes: deployedBytes?.length ?? null,
      sha256Local: sha(localBytes),
      sha256Deployed: deployedBytes === null ? null : sha(deployedBytes),
      exactlyEqual: deployedBytes?.equals(localBytes) ?? false,
      gitNumstat: numstat, error
    });
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
console.log(JSON.stringify({ at: new Date().toISOString(), report }, null, 2));
