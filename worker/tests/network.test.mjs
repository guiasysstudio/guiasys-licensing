import test from "node:test";
import assert from "node:assert/strict";

import { fetchWithTimeout } from "../src/network.js";

test("fetchWithTimeout preserva resposta normal", async () => {
  const fakeFetch = async (_input, init) => {
    assert.ok(init.signal);
    return new Response("ok", { status: 200 });
  };

  const response = await fetchWithTimeout("https://example.test", {}, 100, fakeFetch);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "ok");
});

test("fetchWithTimeout converte timeout em erro 504 seguro", async () => {
  const fakeFetch = async (_input, init) => await new Promise((resolve, reject) => {
    init.signal.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });

  await assert.rejects(
    () => fetchWithTimeout("https://example.test", {}, 5, fakeFetch),
    error => {
      assert.equal(error?.status, 504);
      assert.equal(error?.reason, "upstream_timeout");
      assert.equal(error?.message, "Serviço temporariamente indisponível.");
      return true;
    }
  );
});

test("fetchWithTimeout converte falha de rede em 502 sem vazar detalhe", async () => {
  const fakeFetch = async () => {
    throw new Error("socket secreto detalhado");
  };

  await assert.rejects(
    () => fetchWithTimeout("https://example.test", {}, 100, fakeFetch),
    error => {
      assert.equal(error?.status, 502);
      assert.equal(error?.reason, "upstream_error");
      assert.equal(error?.message, "Serviço externo temporariamente indisponível.");
      return true;
    }
  );
});
