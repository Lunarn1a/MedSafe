export class ModelUnavailableError extends Error {
  constructor(message = 'No model integration has been configured.') {
    super(message);
    this.name = 'ModelUnavailableError';
  }
}

export function createAiClient({ endpoint, fetchImpl = globalThis.fetch } = {}) {
  return {
    async checkInteractions(medicines) {
      if (!endpoint) {
        throw new ModelUnavailableError();
      }

      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ medicines }),
      });

      if (!response.ok) {
        throw new Error(`Interaction service returned ${response.status}.`);
      }

      return response.json();
    },
  };
}
