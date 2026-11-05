import assert from 'node:assert/strict';
import test from 'node:test';
import { createAiClient, ModelUnavailableError } from '../assets/js/services/ai-client.js';

test('does not invent an AI endpoint before one is configured', async () => {
  await assert.rejects(
    createAiClient().checkInteractions([]),
    ModelUnavailableError,
  );
});
