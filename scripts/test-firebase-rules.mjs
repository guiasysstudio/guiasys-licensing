import assert from "node:assert/strict";

const projectId = process.env.GCLOUD_PROJECT || "guiasys-licensing";
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const storageHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;

assert.equal(projectId, "guiasys-licensing");
assert.ok(firestoreHost, "FIRESTORE_EMULATOR_HOST ausente.");
assert.ok(storageHost, "FIREBASE_STORAGE_EMULATOR_HOST ausente.");

function base64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

const now = Math.floor(Date.now() / 1000);
const token = [
  base64Url({ alg: "none", typ: "JWT" }),
  base64Url({
    aud: projectId,
    iss: `https://securetoken.google.com/${projectId}`,
    sub: "rules-probe-user",
    user_id: "rules-probe-user",
    iat: now - 10,
    exp: now + 3600,
    auth_time: now - 10,
    firebase: { sign_in_provider: "password" }
  }),
  ""
].join(".");

const firestoreDocument = `http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents/rulesProbe/client`;
const storageBucket = `${projectId}.appspot.com`;
const storageObject = `http://${storageHost}/v0/b/${storageBucket}/o/private%2Frules-probe.txt`;
const storageUpload = `http://${storageHost}/v0/b/${storageBucket}/o?uploadType=media&name=private%2Frules-probe.txt`;
const authenticated = { Authorization: `Bearer ${token}` };

const probes = [
  ["Firestore anonymous read", firestoreDocument, { method: "GET" }],
  ["Firestore anonymous write", firestoreDocument, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { status: { stringValue: "paid" } } })
  }],
  ["Firestore authenticated read", firestoreDocument, {
    method: "GET",
    headers: authenticated
  }],
  ["Firestore authenticated write", firestoreDocument, {
    method: "PATCH",
    headers: { ...authenticated, "Content-Type": "application/json" },
    body: JSON.stringify({
      fields: {
        customerUid: { stringValue: "rules-probe-user" },
        totalCents: { integerValue: "1" },
        status: { stringValue: "paid" }
      }
    })
  }],
  ["Storage authenticated read", `${storageObject}?alt=media`, {
    method: "GET",
    headers: authenticated
  }],
  ["Storage authenticated write", storageUpload, {
    method: "POST",
    headers: { ...authenticated, "Content-Type": "text/plain" },
    body: "blocked"
  }]
];

for (const [name, url, options] of probes) {
  const response = await fetch(url, options);
  assert.equal(response.status, 403, `${name}: esperado HTTP 403, recebido ${response.status}`);
}

console.log(`Firestore/Storage deny-all rules: ${probes.length}/${probes.length} bloqueios confirmados.`);
