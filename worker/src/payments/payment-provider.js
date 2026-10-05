export class PaymentProvider {
  async createPayment() { throw new Error("not_implemented"); }
  async getPayment() { throw new Error("not_implemented"); }
  async cancelPayment() { throw new Error("not_implemented"); }
  async verifyWebhook() { throw new Error("not_implemented"); }
  async normalizeEvent() { throw new Error("not_implemented"); }
}

export class PagBankProvider extends PaymentProvider {
  #unavailable() {
    throw Object.assign(new Error("O provedor PagBank ainda não está configurado."), {
      status: 503,
      reason: "payment_provider_not_configured"
    });
  }

  async createPayment() { return this.#unavailable(); }
  async getPayment() { return this.#unavailable(); }
  async cancelPayment() { return this.#unavailable(); }
  async verifyWebhook() { return this.#unavailable(); }
  async normalizeEvent() { return this.#unavailable(); }
}
