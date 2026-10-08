import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

import { downloadRemoteImage, isPublicInternetAddress, resolvePublicImageUrl } from "../src/remote-image.js";

function requestSequence(responses, calls = []) {
  return (options, callback) => {
    calls.push(options);
    const request = new EventEmitter();
    request.setTimeout = () => request;
    request.destroy = error => { if (error) queueMicrotask(() => request.emit("error", error)); };
    request.end = () => queueMicrotask(() => {
      const definition = responses.shift();
      const response = Readable.from(definition.chunks || []);
      response.statusCode = definition.statusCode;
      response.headers = definition.headers || {};
      callback(response);
    });
    return request;
  };
}

test("importador aceita somente endereços HTTPS públicos", async () => {
  assert.equal(isPublicInternetAddress("8.8.8.8"), true);
  assert.equal(isPublicInternetAddress("2606:4700:4700::1111"), true);
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "::1", "fc00::1", "fe80::1"]) {
    assert.equal(isPublicInternetAddress(address), false);
  }
  await assert.rejects(() => resolvePublicImageUrl("http://example.com/image.png"), error => error.reason === "invalid_image_url");
  await assert.rejects(() => resolvePublicImageUrl("https://user:pass@example.com/image.png"), error => error.reason === "invalid_image_url");
  await assert.rejects(() => resolvePublicImageUrl("https://localhost/image.png"), error => error.reason === "invalid_image_url");
  await assert.rejects(() => resolvePublicImageUrl("https://127.0.0.1/image.png"), error => error.reason === "invalid_image_url");
  await assert.rejects(() => resolvePublicImageUrl(`https://example.com/${"a".repeat(2048)}`), error => error.reason === "invalid_image_url");
  await assert.rejects(
    () => resolvePublicImageUrl("https://metadata.example/image.png", async () => [{ address: "169.254.169.254", family: 4 }]),
    error => error.reason === "invalid_image_url"
  );
  const resolved = await resolvePublicImageUrl(
    "https://images.example.com/logo.png",
    async () => [{ address: "93.184.216.34", family: 4 }]
  );
  assert.equal(resolved.address, "93.184.216.34");
});

test("download remoto fixa DNS público, valida redirect, MIME, assinatura e limite", async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const calls = [];
  const image = await downloadRemoteImage("https://images.example.com/start", {
    maxBytes: 32,
    lookupImpl: async hostname => [{ address: hostname === "cdn.example.com" ? "93.184.216.35" : "93.184.216.34", family: 4 }],
    requestImpl: requestSequence([
      { statusCode: 302, headers: { location: "https://cdn.example.com/logo.png" } },
      { statusCode: 200, headers: { "content-type": "image/png", "content-length": String(png.length) }, chunks: [png] }
    ], calls)
  });
  assert.equal(image.contentType, "image/png");
  assert.equal(image.extension, "png");
  assert.equal(calls[0].hostname, "93.184.216.34");
  assert.equal(calls[0].servername, "images.example.com");
  assert.equal(calls[1].hostname, "93.184.216.35");
  assert.equal(calls[1].servername, "cdn.example.com");

  await assert.rejects(
    () => downloadRemoteImage("https://images.example.com/large.png", {
      maxBytes: 4,
      lookupImpl: async () => [{ address: "93.184.216.34", family: 4 }],
      requestImpl: requestSequence([{ statusCode: 200, headers: { "content-type": "image/png", "content-length": "8" }, chunks: [png] }])
    }),
    error => error.reason === "payload_too_large"
  );
  await assert.rejects(
    () => downloadRemoteImage("https://images.example.com/fake.png", {
      lookupImpl: async () => [{ address: "93.184.216.34", family: 4 }],
      requestImpl: requestSequence([{ statusCode: 200, headers: { "content-type": "text/html" }, chunks: [Buffer.from("<html>")] }])
    }),
    error => error.reason === "invalid_media_type"
  );
  await assert.rejects(
    () => downloadRemoteImage("https://images.example.com/redirect", {
      lookupImpl: async hostname => [{ address: hostname === "internal.example" ? "127.0.0.1" : "93.184.216.34", family: 4 }],
      requestImpl: requestSequence([{ statusCode: 302, headers: { location: "https://internal.example/secret" } }])
    }),
    error => error.reason === "invalid_image_url"
  );
});
