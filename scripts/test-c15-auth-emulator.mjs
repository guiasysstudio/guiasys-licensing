import assert from "node:assert/strict";

const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
assert.ok(host, "FIREBASE_AUTH_EMULATOR_HOST ausente.");
assert.match(host, /^(?:127\.0\.0\.1|localhost):\d+$/, "Auth Emulator deve usar host local.");
assert.equal(process.env.GCLOUD_PROJECT, "demo-guiasys-licensing", "Auth Emulator deve usar o projeto ficticio.");

const endpoint = path => `http://${host}/identitytoolkit.googleapis.com/v1/${path}?key=emulator-key`;
const email = "cliente.c15@example.com";
const password = "Senha-C15-123";

const signup = await fetch(endpoint("accounts:signUp"), {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password, returnSecureToken: true })
});
assert.equal(signup.status, 200);
const account = await signup.json();
assert.ok(account.localId);
assert.ok(account.idToken);
assert.equal(account.email, email);

const login = await fetch(endpoint("accounts:signInWithPassword"), {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password, returnSecureToken: true })
});
assert.equal(login.status, 200);
assert.equal((await login.json()).localId, account.localId);

const reset = await fetch(endpoint("accounts:sendOobCode"), {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ requestType: "PASSWORD_RESET", email })
});
assert.equal(reset.status, 200);
assert.equal((await reset.json()).email, email);

console.log("C15 Auth Emulator: OK — cadastro, login por senha e recuperação.");
