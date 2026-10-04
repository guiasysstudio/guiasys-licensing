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

const results = await Promise.all([
  client.runTransaction(async tx => {
    const current = await tx.get("atomicity/counter");
    await new Promise(resolve => setTimeout(resolve, 50));
    tx.set("atomicity/counter", { count: Number(current.count || 0) + 1 });
    return "A";
  }),
  client.runTransaction(async tx => {
    const current = await tx.get("atomicity/counter");
    tx.set("atomicity/counter", { count: Number(current.count || 0) + 1 });
    return "B";
  })
]);

if (results.length !== 2) throw new Error("As duas transações não concluíram.");

const finalCounter = await directGet("atomicity/counter");
if (finalCounter.count !== 2) {
  throw new Error(`Retry transacional perdeu atualização. Valor final: ${finalCounter.count}`);
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

console.log("Firestore atomic client contention/retry + multi-write OK.");
