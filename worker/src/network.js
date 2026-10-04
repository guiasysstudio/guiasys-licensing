function upstreamError(status, reason, message) {
  return Object.assign(new Error(message), { status, reason });
}

export async function fetchWithTimeout(input, init = {}, timeoutMs = 10_000, fetchImpl = fetch) {
  const timeout = Number(timeoutMs);
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new TypeError("timeoutMs deve ser um número positivo.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw upstreamError(504, "upstream_timeout", "Serviço temporariamente indisponível.");
    }

    throw Object.assign(
      upstreamError(502, "upstream_error", "Serviço externo temporariamente indisponível."),
      { cause: error }
    );
  } finally {
    clearTimeout(timer);
  }
}
