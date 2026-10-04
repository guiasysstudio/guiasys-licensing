const projectId = "guiasys-licensing";
const root = `http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents`;

function fields(value) {
  return {
    count: { integerValue: String(value) }
  };
}

async function jsonFetch(url, options = {}, allowed = [200]) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => null);
  if (!allowed.includes(response.status)) {
    const error = new Error(`Firestore Emulator respondeu ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return { response, data };
}

async function setCounter(value) {
  await jsonFetch(`${root}/atomicity/counter`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: fields(value) })
  });
}

async function getCounter(transaction = "") {
  const url = new URL(`${root}/atomicity/counter`);
  if (transaction) url.searchParams.set("transaction", transaction);
  const { data } = await jsonFetch(url);
  return Number(data.fields?.count?.integerValue || 0);
}

async function begin(retryTransaction = "") {
  const body = retryTransaction
    ? { options: { readWrite: { retryTransaction } } }
    : { options: { readWrite: {} } };
  const { data } = await jsonFetch(`${root}:beginTransaction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!data?.transaction) throw new Error("Firestore Emulator não retornou transaction.");
  return data.transaction;
}

async function commit(transaction, value) {
  const response = await fetch(`${root}:commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transaction,
      writes: [{
        update: {
          name: `projects/${projectId}/databases/(default)/documents/atomicity/counter`,
          fields: fields(value)
        }
      }]
    })
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

async function incrementWithRetry() {
  let retryTransaction = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const transaction = await begin(retryTransaction);
    const current = await getCounter(transaction);
    const result = await commit(transaction, current + 1);
    if (result.status >= 200 && result.status < 300) return;

    const code = result.data?.error?.status || "";
    if (code !== "ABORTED" && result.status !== 409) {
      throw new Error(`Falha transacional não retryable: ${result.status} ${code}`);
    }
    retryTransaction = transaction;
  }
  throw new Error("Transaction retry limit excedido.");
}

await setCounter(0);

const txA = await begin();
const txB = await begin();
const valueA = await getCounter(txA);
const valueB = await getCounter(txB);

if (valueA !== 0 || valueB !== 0) {
  throw new Error("Leitura inicial transacional inconsistente.");
}

const first = await commit(txA, valueA + 1);
if (first.status < 200 || first.status >= 300) {
  throw new Error("Primeiro commit transacional deveria ter sucesso.");
}

const second = await commit(txB, valueB + 1);
const secondCode = second.data?.error?.status || "";
if (second.status >= 200 && second.status < 300) {
  throw new Error("Firestore aceitou dois commits concorrentes sobre a mesma leitura.");
}
if (second.status !== 409 && secondCode !== "ABORTED") {
  throw new Error(`Conflito retornou status inesperado: ${second.status} ${secondCode}`);
}

await incrementWithRetry();

const finalValue = await getCounter();
if (finalValue !== 2) {
  throw new Error(`Retry transacional perdeu atualização. Valor final: ${finalValue}`);
}

console.log("Firestore transaction contention/retry OK.");
