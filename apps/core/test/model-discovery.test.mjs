import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  discoverModels,
  detectLocalModels,
} from '../dist/runtime/modelDiscovery.js';
import { ModelSettings } from '../dist/runtime/modelSettings.js';
import { MemorySecrets } from '../dist/runtime/credentials.js';

async function server(t, handler) {
  const s = createServer(handler);
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  t.after(() => {
    s.closeAllConnections();
    return new Promise((r) => s.close(r));
  });
  return `http://127.0.0.1:${s.address().port}`;
}
const json = (res, body, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
test('local discovery reads downloaded models, separates empty/auth/offline states, and never starts inference', async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push([url, init]);
    return Response.json(
      url.includes('11434')
        ? {
            models: [
              { name: 'qwen3:8b' },
              { name: 'qwen3:8b' },
              { name: 'nomic-embed-text' },
            ],
          }
        : {
            models: [
              {
                type: 'llm',
                key: 'local-qwen',
                display_name: 'Local Qwen',
                loaded_instances: [],
                max_context_length: 32768,
                capabilities: { trained_for_tool_use: true },
              },
              { type: 'embedding', key: 'local-vector' },
            ],
          },
    );
  };
  const detected = await detectLocalModels(fetcher);
  assert.deepEqual(
    detected.map((d) => d.status),
    ['ready', 'ready'],
  );
  assert.deepEqual(
    detected[0].models.map((m) => m.id),
    ['qwen3:8b'],
  );
  assert.equal(detected[1].models[0].name, 'Local Qwen');
  assert.equal(detected[1].models[0].toolUse, true);
  assert.equal(calls.length, 2);
  assert.ok(
    calls.every(
      ([, init]) => !init.method && !init.headers.authorization && init.signal,
    ),
  );
  const empty = await detectLocalModels(async () =>
    Response.json({ models: [] }),
  );
  assert.ok(empty.every((d) => d.status === 'empty'));
  const auth = await detectLocalModels(
    async () => new Response('', { status: 401 }),
  );
  assert.ok(auth.every((d) => d.status === 'unauthorized'));
  const down = await detectLocalModels(async () => {
    throw new Error('offline');
  });
  assert.ok(down.every((d) => d.status === 'unavailable'));
});
test('LM Studio falls back only on unsupported native listing, not authentication failures', async () => {
  const paths = [];
  const result = await discoverModels(
    { provider: 'lmstudio', baseUrl: 'http://localhost:1234/v1' },
    undefined,
    async (url) => {
      paths.push(url);
      return url.endsWith('/api/v1/models')
        ? new Response('', { status: 404 })
        : Response.json({ data: [{ id: 'loaded-llm' }] });
    },
  );
  assert.equal(result.models[0].id, 'loaded-llm');
  assert.equal(paths.length, 2);
  let attempts = 0;
  await assert.rejects(
    discoverModels(
      { provider: 'lmstudio', baseUrl: 'http://localhost:1234' },
      'key',
      async () => {
        attempts++;
        return new Response('', { status: 401 });
      },
    ),
    /authentication/,
  );
  assert.equal(attempts, 1);
});
test('Anthropic and Google paginate using correct authentication and filter non-chat models', async () => {
  for (const provider of ['anthropic', 'google']) {
    const requests = [];
    const result = await discoverModels(
      {
        provider,
        baseUrl:
          provider === 'google'
            ? 'https://example.test/v1beta'
            : 'https://example.test',
      },
      'fixture',
      async (url, init) => {
        requests.push([new URL(url), init]);
        if (provider === 'anthropic')
          return Response.json(
            requests.length === 1
              ? {
                  data: [{ id: 'claude-sonnet-4-6' }],
                  has_more: true,
                  last_id: 'claude-sonnet-4-6',
                }
              : { data: [{ id: 'custom-claude' }], has_more: false },
          );
        return Response.json(
          requests.length === 1
            ? {
                models: [
                  {
                    name: 'models/gemini-2.5-flash',
                    displayName: 'Gemini Flash',
                    inputTokenLimit: 1000000,
                    outputTokenLimit: 65536,
                    supportedGenerationMethods: ['generateContent'],
                  },
                ],
                nextPageToken: 'second',
              }
            : {
                models: [
                  {
                    name: 'models/text-embedding',
                    supportedGenerationMethods: ['embedContent'],
                  },
                  {
                    name: 'models/custom-gemini',
                    supportedGenerationMethods: ['generateContent'],
                  },
                ],
              },
        );
      },
    );
    assert.equal(requests.length, 2);
    assert.equal(result.models.length, 2);
    assert.equal(
      requests[0][1].headers[
        provider === 'google' ? 'x-goog-api-key' : 'x-api-key'
      ],
      'fixture',
    );
    assert.equal(
      requests[1][0].searchParams.get(
        provider === 'google' ? 'pageToken' : 'after_id',
      ),
      provider === 'google' ? 'second' : 'claude-sonnet-4-6',
    );
    assert.ok(!requests.some(([u]) => u.href.includes('fixture')));
  }
});
test('saved-key discovery stays scoped to endpoint, does not persist draft keys, and ignores error bodies and redirects', async (t) => {
  const calls = [];
  const url = await server(t, (req, res) => {
    calls.push(req.headers.authorization);
    json(res, {
      data: [
        { id: 'chat-a', name: 'A' },
        { id: 'chat-b', name: 'B' },
      ],
    });
  });
  const dir = await mkdtemp(join(tmpdir(), 'seris-discovery-'));
  t.after(() => rm(dir, { force: true, recursive: true }));
  const file = join(dir, 'models.json');
  const secrets = new MemorySecrets();
  const settings = new ModelSettings(file, secrets, {});
  await settings.init();
  const input = {
    provider: 'openai-compatible',
    name: 'Gateway',
    baseUrl: `${url}/v1`,
    requiresKey: true,
    modelId: 'chat-a',
    apiKey: 'fixture-key',
    models: [
      { id: 'chat-a', name: 'A' },
      { id: 'chat-b', name: 'B' },
    ],
  };
  const saved = await settings.save(input);
  const id = saved.selected.connectionId;
  const before = await readFile(file, 'utf8');
  await settings.discover({ ...input, id, apiKey: '' });
  assert.equal(calls[0], 'Bearer fixture-key');
  await assert.rejects(
    settings.discover({ ...input, id, baseUrl: `${url}/other`, apiKey: '' }),
    /API key is required/,
  );
  assert.equal(calls.length, 1);
  await settings.discover({ ...input, apiKey: 'unsaved-key' });
  assert.equal(calls[1], 'Bearer unsaved-key');
  assert.equal(await readFile(file, 'utf8'), before);
  assert.equal(await secrets.read(id), 'fixture-key');
  await settings.select({ connectionId: id, modelId: 'chat-b' });
  await settings.save({ ...input, id, apiKey: '', name: 'Renamed' });
  assert.equal(settings.config().selected.modelId, 'chat-b');
  const restored = new ModelSettings(file, secrets, {});
  await restored.init();
  assert.equal(restored.kernel.model.id, 'chat-b');
  assert.equal(restored.config().connections[0].models.length, 2);
  await assert.rejects(
    settings.select({ connectionId: id, modelId: 'not-enabled' }),
    /not enabled/,
  );
  await assert.rejects(
    settings.save({ ...input, id, models: [] }),
    /at least one/,
  );
  const bad = await server(t, (_req, res) =>
    json(res, { error: 'Rejected fixture-key' }, 401),
  );
  await assert.rejects(
    discoverModels(
      { provider: 'openai-compatible', baseUrl: bad },
      'fixture-key',
    ),
    (e) => e.message === 'Model service authentication failed',
  );
  const redirect = await server(t, (_req, res) => {
    res.writeHead(302, { location: url });
    res.end();
  });
  await assert.rejects(
    discoverModels(
      { provider: 'openai-compatible', baseUrl: redirect },
      'fixture-key',
    ),
    /unavailable/,
  );
  assert.equal(calls.length, 2);
});
test('discovery timeout and malformed response do not turn failures into an empty success', async (t) => {
  const stalled = await server(t, () => {});
  await assert.rejects(
    discoverModels(
      { provider: 'local', baseUrl: stalled },
      undefined,
      fetch,
      50,
    ),
    /unavailable/,
  );
  await assert.rejects(
    discoverModels(
      { provider: 'local', baseUrl: stalled },
      undefined,
      async () => Response.json({ wrong: [] }),
    ),
    /Invalid model list/,
  );
});

test('editing output limits validates the retained active model before persistence', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'seris-model-limits-'));
  t.after(() => rm(dir, { force: true, recursive: true }));
  const file = join(dir, 'models.json');
  const secrets = new MemorySecrets();
  const settings = new ModelSettings(file, secrets, {});
  await settings.init();
  const input = {
    name: 'Local',
    provider: 'local',
    baseUrl: 'http://127.0.0.1:9/v1',
    modelId: 'large',
    requiresKey: false,
    models: [
      { id: 'large', name: 'Large', contextWindow: 32768 },
      { id: 'small', name: 'Small', contextWindow: 1024 },
    ],
  };
  const saved = await settings.save(input);
  const id = saved.selected.connectionId;
  await settings.select({ connectionId: id, modelId: 'small' });
  const before = await readFile(file, 'utf8');
  await assert.rejects(
    settings.save({ ...input, id, maxTokens: 2000, apiKey: 'new-key' }),
    /Output limit/,
  );
  assert.equal(await readFile(file, 'utf8'), before);
  assert.equal(await secrets.read(id), undefined);
  assert.equal(settings.kernel.model.id, 'small');
  assert.equal(settings.kernel.model.maxTokens, 256);
});
