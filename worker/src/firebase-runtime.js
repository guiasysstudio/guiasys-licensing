import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { randomUUID } from "node:crypto";

import {
  assertFirestorePath,
  assertSafePathSegment,
  assertStorageObjectPath
} from "./security.js";

function projectIdFromEnvironment(app) {
  if (app?.options?.projectId) return app.options.projectId;
  if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT;
  if (process.env.GOOGLE_CLOUD_PROJECT) return process.env.GOOGLE_CLOUD_PROJECT;

  try {
    const config = JSON.parse(process.env.FIREBASE_CONFIG || "{}");
    if (config?.projectId) return config.projectId;
  } catch {
    // O runtime oficial sempre fornece FIREBASE_CONFIG válido.
  }

  throw new Error("Não foi possível determinar o projectId do Firebase.");
}

function normalizeValue(value) {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date ? date.toISOString() : value;
  }
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeValue(item)])
    );
  }
  return value;
}

function decodeSnapshot(snapshot) {
  if (!snapshot?.exists) return null;
  const decoded = {
    id: snapshot.id,
    ...normalizeValue(snapshot.data() || {})
  };

  Object.defineProperty(decoded, "__updateTime", {
    value: snapshot.updateTime?.toDate?.().toISOString?.() || "",
    enumerable: false,
    configurable: false
  });

  return decoded;
}

function firestoreError(error) {
  const code = Number(error?.code);
  const reason = String(error?.code || error?.details || "");

  if ([6, 9, 10].includes(code) || /ALREADY_EXISTS|FAILED_PRECONDITION|ABORTED/i.test(reason)) {
    return Object.assign(new Error("Conflito de concorrência. Tente novamente."), {
      status: 409,
      reason: code === 10 || /ABORTED/i.test(reason)
        ? "transaction_contention"
        : "concurrency_conflict",
      cause: error
    });
  }

  return Object.assign(new Error("Falha ao acessar o Firestore."), {
    status: 502,
    reason: "upstream_error",
    cause: error
  });
}

function validateQueryField(fieldPath) {
  const field = String(fieldPath || "");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(field)) {
    throw Object.assign(new Error("Campo de consulta inválido."), {
      status: 400,
      reason: "invalid_identifier"
    });
  }
  return field;
}

export function createFirebaseRuntime({
  app = null,
  auth = null,
  firestore = null,
  storage = null,
  log = null
} = {}) {
  const firebaseApp = app || getApps()[0] || initializeApp();
  const authClient = auth || getAuth(firebaseApp);
  const db = firestore || getFirestore(firebaseApp);
  let storageBucket = null;
  const bucket = () => {
    storageBucket ||= (storage || getStorage(firebaseApp)).bucket();
    return storageBucket;
  };
  const projectId = projectIdFromEnvironment(firebaseApp);

  function doc(path) {
    return db.doc(assertFirestorePath(path));
  }

  async function getDoc(path) {
    try {
      return decodeSnapshot(await doc(path).get());
    } catch (error) {
      throw firestoreError(error);
    }
  }

  async function setDoc(path, value) {
    try {
      const ref = doc(path);
      await ref.set(value);
      return { id: ref.id, ...normalizeValue(value) };
    } catch (error) {
      throw firestoreError(error);
    }
  }

  async function deleteDoc(path) {
    try {
      await doc(path).delete();
    } catch (error) {
      throw firestoreError(error);
    }
  }

  async function uploadStorageObject(path, { bytes, contentType }) {
    const safePath = assertStorageObjectPath(path);
    const token = randomUUID();
    try {
      const activeBucket = bucket();
      const file = activeBucket.file(safePath);
      await file.save(Buffer.from(bytes), {
        resumable: false,
        validation: "crc32c",
        metadata: {
          contentType,
          cacheControl: "public, max-age=31536000, immutable",
          metadata: { firebaseStorageDownloadTokens: token }
        }
      });
      return {
        path: safePath,
        url: `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(activeBucket.name)}/o/${encodeURIComponent(safePath)}?alt=media&token=${encodeURIComponent(token)}`
      };
    } catch (error) {
      throw Object.assign(new Error("Falha ao gravar a mídia no Storage."), {
        status: 502,
        reason: "upstream_error",
        cause: error
      });
    }
  }

  async function deleteStorageObject(path) {
    const safePath = assertStorageObjectPath(path);
    try {
      await bucket().file(safePath).delete({ ignoreNotFound: true });
    } catch (error) {
      throw Object.assign(new Error("Falha ao remover a mídia do Storage."), {
        status: 502,
        reason: "upstream_error",
        cause: error
      });
    }
  }

  async function listCollection(path) {
    try {
      const safePath = assertFirestorePath(path);
      const snapshot = await db.collection(safePath).get();
      return snapshot.docs.map(decodeSnapshot);
    } catch (error) {
      throw firestoreError(error);
    }
  }

  function atomicClient() {
    return {
      async runTransaction(operation, { maxAttempts = 5 } = {}) {
        try {
          return await db.runTransaction(async nativeTx => {
            const writes = [];

            const tx = {
              get: async path => decodeSnapshot(await nativeTx.get(doc(path))),

              queryByField: async (parentPath, collectionId, fieldPath, value) => {
                const parent = assertFirestorePath(parentPath);
                const collection = assertSafePathSegment(collectionId, "Coleção");
                const field = validateQueryField(fieldPath);
                const query = db.collection(`${parent}/${collection}`).where(field, "==", value);
                const snapshot = await nativeTx.get(query);
                return snapshot.docs.map(decodeSnapshot);
              },

              set(path, value) {
                writes.push({ type: "set", ref: doc(path), value });
              },

              create(path, value) {
                writes.push({ type: "create", ref: doc(path), value });
              },

              delete(path) {
                writes.push({ type: "delete", ref: doc(path) });
              }
            };

            const result = await operation(tx);

            for (const write of writes) {
              if (write.type === "set") nativeTx.set(write.ref, write.value);
              if (write.type === "create") nativeTx.create(write.ref, write.value);
              if (write.type === "delete") nativeTx.delete(write.ref);
            }

            return result;
          }, { maxAttempts });
        } catch (error) {
          if (Number(error?.status) >= 400 && Number(error?.status) < 500) throw error;
          throw firestoreError(error);
        }
      },

      async setIfUnchanged(path, value, updateTime) {
        if (!updateTime) {
          throw Object.assign(new Error("Versão do documento ausente."), {
            status: 409,
            reason: "concurrency_conflict"
          });
        }

        return await this.runTransaction(async tx => {
          const current = await tx.get(path);
          if (!current || current.__updateTime !== updateTime) {
            throw Object.assign(new Error("Documento foi alterado por outra operação."), {
              status: 409,
              reason: "concurrency_conflict"
            });
          }
          tx.set(path, value);
          return value;
        });
      }
    };
  }

  async function verifyIdToken(idToken) {
    try {
      return await authClient.verifyIdToken(idToken, true);
    } catch (error) {
      if (error?.code === "auth/id-token-revoked") {
        throw Object.assign(new Error("Sessão Firebase revogada."), {
          status: 401,
          reason: "firebase_token_revoked",
          cause: error
        });
      }

      throw Object.assign(new Error("Token Firebase inválido."), {
        status: 401,
        reason: "invalid_token",
        cause: error
      });
    }
  }

  async function getAccountState(uid) {
    let user;
    try {
      user = await authClient.getUser(uid);
    } catch (error) {
      if (error?.code === "auth/user-not-found") return null;
      throw Object.assign(new Error("Não foi possível consultar a conta Firebase."), {
        status: 502,
        reason: "upstream_error",
        cause: error
      });
    }
    const validSinceMs = user.tokensValidAfterTime
      ? new Date(user.tokensValidAfterTime).getTime()
      : 0;

    return {
      localId: user.uid,
      email: user.email || null,
      displayName: user.displayName || null,
      photoUrl: user.photoURL || null,
      emailVerified: Boolean(user.emailVerified),
      disabled: Boolean(user.disabled),
      validSince: Number.isFinite(validSinceMs) && validSinceMs > 0
        ? String(Math.floor(validSinceMs / 1000))
        : "0"
    };
  }

  function structuredLog(level, event, details = {}) {
    if (typeof log === "function") {
      log(level, event, details);
      return;
    }

    const writer = console[level] || console.log;
    writer(JSON.stringify({ event, ...details }));
  }

  return {
    runtime: "firebase-functions-v2",
    projectId,
    verifyIdToken,
    getAccountState,
    getDoc,
    setDoc,
    deleteDoc,
    uploadStorageObject,
    deleteStorageObject,
    listCollection,
    atomicClient,
    log: structuredLog
  };
}
