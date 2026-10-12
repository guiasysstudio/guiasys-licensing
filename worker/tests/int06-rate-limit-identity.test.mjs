import test from "node:test";
import assert from "node:assert/strict";
import { rateLimitIngressPeer } from "../src/rate-limit-identity.js";

function headers(map) { return new Headers(map); }

test("INT-06: XFF usa último IP e ignora prefixo injetado pelo cliente", () => {
  assert.equal(rateLimitIngressPeer(headers({
    "X-Forwarded-For": "198.51.100.8, 203.0.113.10"
  })), "203.0.113.10");
  assert.equal(rateLimitIngressPeer(headers({
    "X-Forwarded-For": "not-an-ip, 198.51.100.1, 203.0.113.10",
    "CF-Connecting-IP": "192.0.2.55"
  })), "203.0.113.10");
});

test("INT-06: nunca usa CF-Connecting-IP nem primeiro XFF como fallback", () => {
  assert.equal(rateLimitIngressPeer(headers({
    "CF-Connecting-IP": "192.0.2.123"
  })), "unattributed");
  assert.equal(rateLimitIngressPeer(headers({
    "X-Forwarded-For": "198.51.100.33, forged"
  })), "unattributed");
  assert.equal(rateLimitIngressPeer(headers({})), "unattributed");
});

test("INT-06: suporta IPv4, IPv6 e rejeita endereços inválidos", () => {
  assert.equal(rateLimitIngressPeer(headers({
    "X-Forwarded-For": "198.51.100.1"
  })), "198.51.100.1");
  assert.equal(rateLimitIngressPeer(headers({
    "X-Forwarded-For": "192.0.2.12, 2001:db8::ff"
  })), "2001:db8::ff");
  assert.equal(rateLimitIngressPeer(headers({
    "X-Forwarded-For": "198.51.100.1, 203.0.113.12:4567"
  })), "unattributed");
  assert.equal(rateLimitIngressPeer(headers({
    "X-Forwarded-For": "198.51.100.1, 999.999.999.999"
  })), "unattributed");
});

test("INT-06: cadeia excessiva é recusada sem promover um prefixo falso", () => {
  const longChain = "192.0.2.1, ".repeat(260) + "203.0.113.5";
  assert.equal(rateLimitIngressPeer(headers({ "X-Forwarded-For": longChain })),
    "unattributed");
});

test("INT-06: proxy compartilhado mantém um único bucket de ingress", () => {
  const first = rateLimitIngressPeer(headers({
    "X-Forwarded-For": "198.51.100.111, 192.0.2.10"
  }));
  const second = rateLimitIngressPeer(headers({
    "X-Forwarded-For": "198.51.100.222, 192.0.2.10"
  }));
  assert.equal(first, second);
  // Não é prova de IP real de usuário atrás do Firebase Hosting CDN.
});
