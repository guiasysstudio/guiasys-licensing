import assert from "node:assert/strict";

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "guiasys-licensing";
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const storageHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;

assert.ok(firestoreHost, "FIRESTORE_EMULATOR_HOST ausente.");
assert.ok(storageHost, "FIREBASE_STORAGE_EMULATOR_HOST ausente.");

const firestoreRead = await fetch(
  `http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents/customerAccounts/probe`
);
assert.equal(firestoreRead.status, 403, "Firestore deve negar leitura direta sem credenciais.");

const firestoreWrite = await fetch(
  `http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents/customerAccounts?documentId=probe`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { unsafe: { booleanValue: true } } })
  }
);
assert.equal(firestoreWrite.status, 403, "Firestore deve negar escrita direta sem credenciais.");

const bucket = `${projectId}.appspot.com`;
const storageRead = await fetch(`http://${storageHost}/v0/b/${bucket}/o`);
assert.equal(storageRead.status, 403, "Storage deve negar listagem direta sem credenciais.");

const storageWrite = await fetch(
  `http://${storageHost}/v0/b/${bucket}/o?uploadType=media&name=profiles%2Fprobe%2Favatar.png`,
  {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    body: new Uint8Array([0x89, 0x50, 0x4e, 0x47])
  }
);
assert.equal(storageWrite.status, 403, "Storage deve negar upload direto sem credenciais.");

console.log("C15 Rules Emulator: OK — Firestore e Storage negam leitura/escrita direta.");
