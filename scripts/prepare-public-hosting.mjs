import { cp, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const dist = path.join(root, ".hosting-public-dist");
const sources = [
  ["public/index.html", "index.html"],
  ["public/404.html", "404.html"],
  ["public/assets", "assets"]
];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const [sourceRel, targetRel] of sources) {
  const source = path.join(root, sourceRel);
  const target = path.join(dist, targetRel);
  const info = await stat(source);

  if (info.isDirectory()) {
    await cp(source, target, { recursive: true, force: true, dereference: true });
  } else {
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target, { force: true, dereference: true });
  }
}

console.log("Firebase Hosting public staging preparado com o catálogo comercial GSL-v1.");
