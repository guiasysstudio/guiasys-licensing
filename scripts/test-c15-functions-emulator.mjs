import assert from "node:assert/strict";

const host = process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5001";
const projectId = process.env.GCLOUD_PROJECT || "guiasys-licensing";
const base = `http://${host}/${projectId}/southamerica-east1/licensingApi`;

const healthResponse = await fetch(`${base}/health`);
assert.equal(healthResponse.status, 200);
const health = await healthResponse.json();
assert.equal(health.ok, true);
assert.equal(health.service, "guiasys-licensing-api");
assert.equal(health.runtime, "firebase-functions-v2");
assert.equal(health.firebaseProject, projectId);

const rootResponse = await fetch(base);
assert.equal(rootResponse.status, 200);
const root = await rootResponse.json();
assert.equal(root.name, "GuiaSys Licensing API");
assert.equal(root.protocolVersion, "GSL-v1");

console.log("C15 Functions Emulator: OK — raiz e health atendidos pela Function v2.");
