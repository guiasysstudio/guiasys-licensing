import { cp, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const dist = path.join(root, ".hosting-admin-dist");

const sources = [
  ["index.html", "index.html"],
  ["assets", "assets"],
  ["public/assets/brand", "assets/brand"]
];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const [sourceRel, targetRel] of sources) {
  const source = path.join(root, sourceRel);
  const target = path.join(dist, targetRel);
  const info = await stat(source);

  if (info.isDirectory()) {
    await cp(source, target, {
      recursive: true,
      force: true,
      dereference: true
    });
  } else {
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target, {
      force: true,
      dereference: true
    });
  }
}

console.log("Firebase Hosting admin staging preparado com index.html + assets/.");
