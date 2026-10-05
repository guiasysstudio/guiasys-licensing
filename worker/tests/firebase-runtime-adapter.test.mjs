import test from "node:test";
import assert from "node:assert/strict";

import { createFirebaseRuntime } from "../src/firebase-runtime.js";

function snapshot(path, data, updateTime = "2026-10-05T00:00:00.000Z") {
  return {
    exists: data !== null,
    id: path.split("/").pop(),
    data: () => data,
    updateTime: {
      toDate: () => new Date(updateTime)
    }
  };
}

function createMocks() {
  const calls = [];
  const docs = new Map([
    ["projects/prj_0123456789abcdefabcd", { name: "Projeto teste", active: true }],
    ["projects/prj_0123456789abcdefabcd/licenses/lic_0123456789abcdefabcd", { customerId: "cus_1", status: "active" }]
  ]);

  const auth = {
    async verifyIdToken(token, checkRevoked) {
      calls.push(["verifyIdToken", token, checkRevoked]);
      return {
        aud: "guiasys-licensing",
        iss: "https://securetoken.google.com/guiasys-licensing",
        sub: "uid-admin",
        exp: 9999999999,
        iat: 1,
        auth_time: 1,
        firebase: { sign_in_provider: "google.com" }
      };
    },
    async getUser(uid) {
      calls.push(["getUser", uid]);
      return {
        uid,
        email: "admin@example.com",
        displayName: "Admin",
        photoURL: null,
        emailVerified: true,
        disabled: false,
        tokensValidAfterTime: "2026-10-05T00:00:00.000Z"
      };
    }
  };

  function doc(path) {
    return {
      path,
      id: path.split("/").pop(),
      async get() {
        calls.push(["doc.get", path]);
        return snapshot(path, docs.has(path) ? docs.get(path) : null);
      },
      async set(value) {
        calls.push(["doc.set", path, value]);
        docs.set(path, value);
      },
      async delete() {
        calls.push(["doc.delete", path]);
        docs.delete(path);
      }
    };
  }

  function collection(path) {
    return {
      path,
      async get() {
        calls.push(["collection.get", path]);
        const prefix = path + "/";
        const rows = [...docs.entries()]
          .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes("/"))
          .map(([key, value]) => snapshot(key, value));
        return { docs: rows };
      },
      where(field, op, value) {
        return { __query: true, path, field, op, value };
      }
    };
  }

  const firestore = {
    doc,
    collection,
    async runTransaction(callback, options) {
      calls.push(["runTransaction", options]);
      const nativeTx = {
        async get(target) {
          if (target?.__query) {
            calls.push(["tx.query", target.path, target.field, target.value]);
            const prefix = target.path + "/";
            const rows = [...docs.entries()]
              .filter(([key, value]) =>
                key.startsWith(prefix) &&
                !key.slice(prefix.length).includes("/") &&
                value?.[target.field] === target.value
              )
              .map(([key, value]) => snapshot(key, value));
            return { docs: rows };
          }

          calls.push(["tx.get", target.path]);
          return snapshot(target.path, docs.has(target.path) ? docs.get(target.path) : null);
        },
        set(ref, value) {
          calls.push(["tx.set", ref.path, value]);
          docs.set(ref.path, value);
        },
        create(ref, value) {
          calls.push(["tx.create", ref.path, value]);
          if (docs.has(ref.path)) {
            const error = new Error("already exists");
            error.code = 6;
            throw error;
          }
          docs.set(ref.path, value);
        },
        delete(ref) {
          calls.push(["tx.delete", ref.path]);
          docs.delete(ref.path);
        }
      };

      return await callback(nativeTx);
    }
  };

  return {
    calls,
    docs,
    auth,
    firestore,
    app: { options: { projectId: "guiasys-licensing" } }
  };
}

test("runtime usa verificação revogada e converte estado real da conta", async () => {
  const mocks = createMocks();
  const runtime = createFirebaseRuntime(mocks);

  const token = await runtime.verifyIdToken("token-admin");
  assert.equal(token.sub, "uid-admin");
  assert.deepEqual(mocks.calls[0], ["verifyIdToken", "token-admin", true]);

  const account = await runtime.getAccountState("uid-admin");
  assert.equal(account.localId, "uid-admin");
  assert.equal(account.emailVerified, true);
  assert.equal(account.disabled, false);
  assert.equal(account.validSince, "1791158400");
});

test("runtime normaliza token revogado e usuário inexistente", async () => {
  const mocks = createMocks();
  mocks.auth.verifyIdToken = async () => {
    const error = new Error("revoked");
    error.code = "auth/id-token-revoked";
    throw error;
  };
  mocks.auth.getUser = async () => {
    const error = new Error("missing");
    error.code = "auth/user-not-found";
    throw error;
  };

  const runtime = createFirebaseRuntime(mocks);

  await assert.rejects(
    () => runtime.verifyIdToken("revoked"),
    error => error?.status === 401 && error?.reason === "firebase_token_revoked"
  );

  assert.equal(await runtime.getAccountState("missing"), null);
});

test("CRUD usa Firestore Admin mantendo shape dos documentos", async () => {
  const mocks = createMocks();
  const runtime = createFirebaseRuntime(mocks);
  const projectPath = "projects/prj_0123456789abcdefabcd";

  const project = await runtime.getDoc(projectPath);
  assert.equal(project.id, "prj_0123456789abcdefabcd");
  assert.equal(project.name, "Projeto teste");

  const saved = await runtime.setDoc(projectPath, { name: "Atualizado", active: true });
  assert.equal(saved.id, "prj_0123456789abcdefabcd");
  assert.equal((await runtime.getDoc(projectPath)).name, "Atualizado");

  const items = await runtime.listCollection("projects");
  assert.equal(items.length, 1);

  await runtime.deleteDoc(projectPath);
  assert.equal(await runtime.getDoc(projectPath), null);
});

test("transação Admin SDK mantém leituras antes das escritas enfileiradas", async () => {
  const mocks = createMocks();
  const runtime = createFirebaseRuntime(mocks);
  const projectPath = "projects/prj_0123456789abcdefabcd";
  const newPath = "projects/prj_0123456789abcdefabcd/plans/plan_0123456789abcdefabcd";

  const result = await runtime.atomicClient().runTransaction(async tx => {
    const project = await tx.get(projectPath);
    const licenses = await tx.queryByField(
      "projects/prj_0123456789abcdefabcd",
      "licenses",
      "customerId",
      "cus_1"
    );

    tx.set(projectPath, { ...project, active: false });
    tx.create(newPath, { name: "Plano" });

    assert.equal(
      mocks.calls.some(call => ["tx.set", "tx.create"].includes(call[0])),
      false,
      "escritas nativas não devem ocorrer antes do fim das leituras"
    );

    return licenses.length;
  });

  assert.equal(result, 1);
  const transactionEvents = mocks.calls
    .filter(call => call[0].startsWith("tx."))
    .map(call => call[0]);

  assert.deepEqual(transactionEvents, ["tx.get", "tx.query", "tx.set", "tx.create"]);
  assert.equal(mocks.docs.get(projectPath).active, false);
  assert.equal(mocks.docs.get(newPath).name, "Plano");
});

test("erro de contenção nativo vira 409 estável", async () => {
  const mocks = createMocks();
  mocks.firestore.runTransaction = async () => {
    const error = new Error("aborted");
    error.code = 10;
    throw error;
  };

  const runtime = createFirebaseRuntime(mocks);

  await assert.rejects(
    () => runtime.atomicClient().runTransaction(async () => null),
    error => error?.status === 409 && error?.reason === "transaction_contention"
  );
});
