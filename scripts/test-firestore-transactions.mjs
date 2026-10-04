import { createFirestoreAtomicClient } from "../worker/src/firestore-atomic.js";

const projectId = "guiasys-licensing";
const apiBase = "http://127.0.0.1:8080/v1";

function encodeValue(value) {
  if (typeof value === "boolean") return { booleanValue: value };
  if (Number.isInteger(value)) return { integerValue: String(value) };
  if (typeof value === "number") return { doubleValue: value };
  if (value === null) return { nullValue: null };
  return { stringValue: String(value) };
}

function encodeFields(object) {
  return Object.fromEntries(
    Object.entries(object).map(([key, value]) => [key, encodeValue(value)])
  );
}

function decodeValue(value) {
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  return null;
}

function decodeFields(fields = {}) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, decodeValue(value)])
  );
}

const client = createFirestoreAtomicClient({
  projectId,
  getAccessToken: async () => "",
  encodeFields,
  encodeValue,
  decodeFields,
  docIdFromName: name => decodeURIComponent(String(name || "").split("/").pop() || ""),
  apiBase
});

const root = `${apiBase}/projects/${projectId}/databases/(default)/documents`;

async function directSet(path, value) {
  const response = await fetch(`${root}/${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: encodeFields(value) })
  });
  if (!response.ok) throw new Error(`directSet falhou: ${response.status}`);
}

async function directGet(path) {
  const response = await fetch(`${root}/${path}`);
  if (!response.ok) throw new Error(`directGet falhou: ${response.status}`);
  const data = await response.json();
  return decodeFields(data.fields || {});
}

await directSet("atomicity/counter", { count: 0 });

for (let index = 0; index < 2; index++) {
  await client.runTransaction(async tx => {
    const current = await tx.get("atomicity/counter");
    tx.set("atomicity/counter", { count: Number(current.count || 0) + 1 });
  });
}

const finalCounter = await directGet("atomicity/counter");
if (finalCounter.count !== 2) {
  throw new Error(`Atualização transacional perdeu valor. Valor final: ${finalCounter.count}`);
}

await directSet("atomicity/retry-collision", { value: 1 });

let operationRuns = 0;
await client.runTransaction(async tx => {
  operationRuns++;

  if (operationRuns === 1) {
    tx.create("atomicity/retry-collision", { value: 2 });
    return;
  }

  const current = await tx.get("atomicity/counter");
  tx.set("atomicity/counter", { count: Number(current.count || 0) + 1 });
});

if (operationRuns < 2) {
  throw new Error("Cliente transacional não refez a operação após conflito.");
}

const afterRetry = await directGet("atomicity/counter");
if (afterRetry.count !== 3) {
  throw new Error(`Retry transacional não concluiu a atualização. Valor final: ${afterRetry.count}`);
}

await client.runTransaction(async tx => {
  tx.create("atomicity/a", { value: 1 });
  tx.create("atomicity/b", { value: 2 });
});

const [a, b] = await Promise.all([
  directGet("atomicity/a"),
  directGet("atomicity/b")
]);

if (a.value !== 1 || b.value !== 2) {
  throw new Error("Commit multi-documento não foi aplicado corretamente.");
}

console.log("Firestore atomic client read/write + retry + multi-write OK.");
