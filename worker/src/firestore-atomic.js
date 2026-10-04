import { assertFirestorePath, assertSafePathSegment } from "./security.js";
import { fetchWithTimeout } from "./network.js";

function conflictError(code = "") {
  return Object.assign(new Error("Conflito de concorrência. Tente novamente."), {
    status: 409,
    reason: code === "ABORTED" ? "transaction_aborted" : "concurrency_conflict",
    firestoreCode: code,
    retryableTransaction: ["ABORTED", "FAILED_PRECONDITION", "ALREADY_EXISTS"].includes(code)
  });
}

function upstreamError(status = 502) {
  return Object.assign(new Error("Falha ao acessar o Firestore."), {
    status,
    reason: status === 504 ? "upstream_timeout" : "upstream_error"
  });
}

export function createFirestoreAtomicClient({
  projectId,
  getAccessToken,
  encodeFields,
  encodeValue,
  decodeFields,
  docIdFromName,
  apiBase = "https://firestore.googleapis.com/v1",
  timeoutMs = 10_000
}) {
  if (!projectId) throw new TypeError("projectId é obrigatório.");
  if (typeof encodeFields !== "function" || typeof encodeValue !== "function" || typeof decodeFields !== "function") {
    throw new TypeError("Codec Firestore inválido.");
  }

  const databaseName = `projects/${projectId}/databases/(default)`;
  const documentsName = `${databaseName}/documents`;
  const documentsUrl = `${apiBase}/${documentsName}`;

  function documentName(path) {
    return `${documentsName}/${assertFirestorePath(path)}`;
  }

  async function request(url, options = {}, { notFoundNull = false } = {}) {
    const token = typeof getAccessToken === "function" ? await getAccessToken() : "";
    const headers = {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { "Authorization": `Bearer ${token}` } : {}),
      ...(options.headers || {})
    };

    let response;
    try {
      response = await fetchWithTimeout(url, { ...options, headers }, timeoutMs);
    } catch (error) {
      if (error?.reason === "upstream_timeout") throw upstreamError(504);
      throw upstreamError(502);
    }

    if (notFoundNull && response.status === 404) return null;

    const data = response.status === 204 ? null : await response.json().catch(() => null);
    if (response.ok) return data;

    const code = String(data?.error?.status || "");
    if (
      response.status === 409 ||
      response.status === 412 ||
      ["ABORTED", "FAILED_PRECONDITION", "ALREADY_EXISTS"].includes(code)
    ) {
      throw conflictError(code || (response.status === 409 ? "ABORTED" : "FAILED_PRECONDITION"));
    }

    throw upstreamError(502);
  }

  function decodeDocument(data) {
    if (!data) return null;
    const decoded = {
      id: typeof docIdFromName === "function"
        ? docIdFromName(data.name)
        : decodeURIComponent(String(data.name || "").split("/").pop() || ""),
      ...decodeFields(data.fields || {})
    };
    Object.defineProperty(decoded, "__updateTime", {
      value: data.updateTime || "",
      enumerable: false,
      configurable: false
    });
    return decoded;
  }

  function updateWrite(path, value, precondition = null) {
    const write = {
      update: {
        name: documentName(path),
        fields: encodeFields(value)
      }
    };
    if (precondition) write.currentDocument = precondition;
    return write;
  }

  function deleteWrite(path, precondition = null) {
    const write = { delete: documentName(path) };
    if (precondition) write.currentDocument = precondition;
    return write;
  }

  async function begin(retryTransaction = "") {
    const body = retryTransaction
      ? { options: { readWrite: { retryTransaction } } }
      : { options: { readWrite: {} } };

    const data = await request(`${documentsUrl}:beginTransaction`, {
      method: "POST",
      body: JSON.stringify(body)
    });
    if (!data?.transaction) throw upstreamError(502);
    return data.transaction;
  }

  async function rollback(transaction) {
    if (!transaction) return;
    try {
      await request(`${documentsUrl}:rollback`, {
        method: "POST",
        body: JSON.stringify({ transaction })
      });
    } catch {
      // Best effort: a transação pode já ter sido abortada pelo servidor.
    }
  }

  async function getInTransaction(path, transaction) {
    const url = new URL(`${documentsUrl}/${assertFirestorePath(path)}`);
    url.searchParams.set("transaction", transaction);
    const data = await request(url, {}, { notFoundNull: true });
    return decodeDocument(data);
  }

  async function queryByField(parentPath, collectionId, fieldPath, value, transaction) {
    const safeParent = assertFirestorePath(parentPath);
    const safeCollection = assertSafePathSegment(collectionId, "Coleção");
    const safeField = String(fieldPath || "");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(safeField)) {
      throw Object.assign(new Error("Campo de consulta inválido."), {
        status: 400,
        reason: "invalid_identifier"
      });
    }

    const data = await request(`${documentsUrl}/${safeParent}:runQuery`, {
      method: "POST",
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: safeCollection }],
          where: {
            fieldFilter: {
              field: { fieldPath: safeField },
              op: "EQUAL",
              value: encodeValue(value)
            }
          }
        },
        transaction
      })
    });

    return (Array.isArray(data) ? data : [])
      .filter(item => item?.document)
      .map(item => decodeDocument(item.document));
  }

  async function commitWrites(writes, transaction = "") {
    const body = { writes };
    if (transaction) body.transaction = transaction;
    return await request(`${documentsUrl}:commit`, {
      method: "POST",
      body: JSON.stringify(body)
    });
  }

  async function runTransaction(operation, { maxAttempts = 5 } = {}) {
    let retryTransaction = "";

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const transaction = await begin(retryTransaction);
      const writes = [];

      const tx = {
        id: transaction,
        get: path => getInTransaction(path, transaction),
        queryByField: (parentPath, collectionId, fieldPath, value) =>
          queryByField(parentPath, collectionId, fieldPath, value, transaction),
        set(path, value) {
          writes.push(updateWrite(path, value));
        },
        create(path, value) {
          writes.push(updateWrite(path, value, { exists: false }));
        },
        delete(path) {
          writes.push(deleteWrite(path));
        }
      };

      try {
        const result = await operation(tx);
        if (writes.length) {
          await commitWrites(writes, transaction);
        } else {
          await rollback(transaction);
        }
        return result;
      } catch (error) {
        await rollback(transaction);

        if (error?.retryableTransaction && attempt < maxAttempts - 1) {
          retryTransaction = error?.firestoreCode === "ABORTED" ? transaction : "";
          await new Promise(resolve => setTimeout(resolve, Math.min(250, 20 * (2 ** attempt))));
          continue;
        }

        throw error;
      }
    }

    throw Object.assign(new Error("Não foi possível concluir a transação por contenção."), {
      status: 409,
      reason: "transaction_contention"
    });
  }

  async function setIfUnchanged(path, value, updateTime) {
    if (!updateTime) {
      throw Object.assign(new Error("Versão do documento ausente."), {
        status: 409,
        reason: "concurrency_conflict"
      });
    }
    await commitWrites([
      updateWrite(path, value, { updateTime })
    ]);
    return value;
  }

  return {
    runTransaction,
    setIfUnchanged,
    updateWrite,
    deleteWrite,
    commitWrites,
    documentName
  };
}
