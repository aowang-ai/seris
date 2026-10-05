import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { ModelSettings } from '../dist/runtime/modelSettings.js';
import { MemorySecrets } from '../dist/runtime/credentials.js';
import { buildKernel, providerCatalog } from '../dist/runtime/streamFactory.js';
import { SerisRuntime } from '../dist/runtime/serisRuntime.js';
import { ToolRegistry } from '../dist/tools/registry.js';
import { AssistantMessageEventStream } from '@earendil-works/pi-ai';

const connection = (extra = {}) => ({
  name: 'Fixture',
  provider: 'openai-compatible',
  baseUrl: 'http://localhost:11434/v1',
  modelId: 'fixture',
  requiresKey: true,
  ...extra,
});
async function setup(t, secrets = new MemorySecrets(), cleanup = true) {
  const dir = await mkdtemp(join(tmpdir(), 'seris-models-'));
  if(cleanup)t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'models.json');
  const settings = new ModelSettings(file, secrets, {});
  await settings.init();
  return { settings, file, secrets, dir };
}
test('provider catalog preserves pi capabilities and isolates credentials between connections', async () => {
  const catalog = providerCatalog();
  assert.equal(catalog.length, 13);
  for (const p of catalog.slice(0, 8)) {
    assert.ok(p.models.length);
    assert.ok(p.baseUrl);
    const k = buildKernel(
      connection({
        provider: p.id,
        baseUrl: p.baseUrl,
        modelId: p.defaultModelId,
      }),
      'fake',
    );
    assert.equal(k.model.id, p.defaultModelId);
    assert.ok(
      k.model.maxTokens <=
        p.models.find((m) => m.id === p.defaultModelId).maxTokens,
    );
  }
  const a = buildKernel(connection({ id: 'a' }), 'key-a');
  const b = buildKernel(connection({ id: 'b' }), 'key-b');
  assert.notEqual(a.models, b.models);
  assert.equal(a.model.api, 'openai-completions');
  assert.equal(b.model.reasoning, false);
  assert.throws(
    () => buildKernel(connection({ contextWindow: 100, maxTokens: 200 })),
    /Output limit/,
  );
});
test('connections persist metadata, preserve blank edits, survive credential-store restart, and select independently', async (t) => {
  const { settings, file, secrets } = await setup(t);
  const a = await settings.save(connection({ apiKey: 'key-a' }));
  const id = a.selected.connectionId;
  await settings.save(
    connection({ name: 'Local', provider: 'local', requiresKey: false }),
  );
  assert.equal(settings.config().connections.length, 2);
  assert.equal(settings.config().selected.connectionId, id);
  await settings.save(
    connection({ id, name: 'Renamed', modelId: 'other-model', apiKey: '' }),
  );
  assert.equal(await secrets.read(id), 'key-a');
  assert.equal(settings.kernel.model.id, 'other-model');
  await settings.select({ connectionId: id, modelId: 'third-model' });
  assert.equal(settings.kernel.model.id, 'third-model');
  const stored = await readFile(file, 'utf8');
  assert.equal(stored.includes('key-a'), false);
  assert.equal(stored.includes('apiKey'), false);
  assert.equal(JSON.stringify(settings.config()).includes('key-a'), false);
  const restored = new ModelSettings(file, secrets, {});
  await restored.init();
  assert.equal(restored.kernel.model.id, 'third-model');
  const memoryRestart = new ModelSettings(file, new MemorySecrets(), {});
  await memoryRestart.init();
  assert.equal(memoryRestart.config().configured, false);
  assert.equal(memoryRestart.config().connections[1].configured, true);
  await restored.remove(id);
  assert.equal(await secrets.read(id), undefined);
  assert.equal(restored.kernel.model.id, 'fixture');
  assert.equal(restored.config().connections.length, 1);
});
test('changing endpoint cannot silently reuse a vendor key and failed vault writes leave prior state intact', async (t) => {
  const { settings, file, secrets } = await setup(t);
  const cfg = await settings.save(connection({ apiKey: 'old-key' }));
  const id = cfg.selected.connectionId;
  await assert.rejects(
    settings.save(
      connection({ id, baseUrl: 'https://another.example/v1', apiKey: '' }),
    ),
    /API key is required/,
  );
  const old = await readFile(file, 'utf8');
  secrets.write = async () => {
    throw new Error('Vault unavailable');
  };
  await assert.rejects(
    settings.save(connection({ id, apiKey: 'new-key' })),
    /Vault unavailable/,
  );
  assert.equal(await readFile(file, 'utf8'), old);
  assert.equal(await secrets.read(id), 'old-key');
  assert.equal(settings.kernel.model.id, 'fixture');
  await assert.rejects(
    settings.save(connection({ baseUrl: 'https://user:password@example.org' })),
    /Invalid API endpoint/,
  );
  await assert.rejects(
    settings.save(
      connection({ contextWindow: 100, maxTokens: 200, apiKey: 'fake' }),
    ),
    /Output limit/,
  );
});
test('environment credentials only apply to their configured vendor endpoint', async (t) => {
  const { file, secrets } = await setup(t);
  const env = { OPENAI_API_KEY: ' env-key ', OPENAI_MODEL: 'gpt-4.1' };
  const first = new ModelSettings(file, secrets, env);
  await first.init();
  assert.equal(first.config().configured, true);
  const id = first.config().selected.connectionId;
  await first.save(
    connection({
      id,
      provider: 'openai',
      baseUrl: 'http://localhost:9999',
      requiresKey: true,
      apiKey: 'explicit-other-key',
    }),
  );
  await secrets.delete(id);
  const restarted = new ModelSettings(file, secrets, env);
  await restarted.init();
  assert.equal(restarted.config().configured, false);
});
async function fakeServer(t, format) {
  const requests = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    requests.push({
      path: req.url,
      headers: req.headers,
      body: JSON.parse(raw),
    });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (format === 'completions')
      res.end(
        `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\ndata: [DONE]\n\n`,
      );
    else if (format === 'google')
      res.end(
        `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'OK' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } })}\n\n`,
      );
    else if (format === 'responses') {
      const item = {
        id: 'msg_fixture',
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: 'OK', annotations: [] }],
      };
      const frames = [
        {
          type: 'response.created',
          response: {
            id: 'response_fixture',
            object: 'response',
            status: 'in_progress',
            output: [],
          },
        },
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: { ...item, status: 'in_progress', content: [] },
        },
        {
          type: 'response.content_part.added',
          item_id: item.id,
          output_index: 0,
          content_index: 0,
          part: { type: 'output_text', text: '', annotations: [] },
        },
        {
          type: 'response.output_text.delta',
          item_id: item.id,
          output_index: 0,
          content_index: 0,
          delta: 'OK',
        },
        { type: 'response.output_item.done', output_index: 0, item },
        {
          type: 'response.completed',
          response: {
            id: 'response_fixture',
            status: 'completed',
            output: [item],
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
          },
        },
      ];
      res.end(
        frames
          .map((x) => `event: ${x.type}\ndata: ${JSON.stringify(x)}\n\n`)
          .join(''),
      );
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((r) => server.close(r));
  });
  return { requests, url: `http://127.0.0.1:${server.address().port}` };
}
for (const [format, extra] of [
  ['completions', { provider: 'openai-compatible' }],
  ['completions', { provider: 'local', requiresKey: false }],
  ['responses', { provider: 'openai-compatible', api: 'openai-responses' }],
  ['responses', { provider: 'openai', modelId: 'gpt-4.1' }],
  ['google', { provider: 'google', modelId: 'gemini-2.5-flash' }],
]) {
  test(`connection test uses pi ${format} transport (${extra.provider}), short output and no tools`, async (t) => {
    const { settings } = await setup(t);
    const { requests, url } = await fakeServer(t, format);
    const cfg = await settings.save(
      connection({
        ...extra,
        baseUrl: format === 'google' ? url : `${url}/v1`,
        apiKey: extra.requiresKey === false ? '' : 'fake-key',
      }),
    );
    assert.equal(cfg.connections[0].testedAt, undefined);
    await settings.test(cfg.selected.connectionId);
    assert.ok(settings.config().connections[0].testedAt);
    assert.equal(requests.length, 1);
    const body = requests[0].body;
    assert.equal(body.tools, undefined);
    assert.equal(
      body.max_tokens ??
        body.max_completion_tokens ??
        body.max_output_tokens ??
        body.generationConfig?.maxOutputTokens,
      32,
    );
    if (extra.requiresKey !== false && format !== 'google')
      assert.equal(requests[0].headers.authorization, 'Bearer fake-key');
  });
}
test('test failure redacts keys and does not mark a saved service as verified', async (t) => {
  const { settings } = await setup(t);
  const server = createServer((_req, res) => {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({ error: { message: 'Rejected secret-fixture-key' } }),
    );
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((r) => server.close(r));
  });
  const cfg = await settings.save(
    connection({
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      apiKey: 'secret-fixture-key',
    }),
  );
  await assert.rejects(
    settings.test(cfg.selected.connectionId),
    (e) => !e.message.includes('secret-fixture-key'),
  );
  assert.equal(settings.config().connections[0].testedAt, undefined);
});
test('switching during a run preserves its captured model, credentials and title provider', async (t) => {
  const { settings, dir } = await setup(t, undefined, false);
  await settings.save(connection({ name: 'Old', apiKey: 'old-key' }));
  let release;
  const gate = new Promise((r) => (release = r));
  const original = settings.kernel;
  let oldCalls = 0;
  let titles = 0;
  const usage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  const answer = {
    role: 'assistant',
    content: [{ type: 'text', text: 'Done' }],
    api: 'openai-completions',
    provider: 'openai-compatible',
    model: 'fixture',
    usage,
    stopReason: 'stop',
    timestamp: Date.now(),
  };
  original.models.streamSimple = () => {
    oldCalls++;
    const stream = new AssistantMessageEventStream();
    stream.push({ type: 'done', reason: 'stop', message: answer });
    return stream;
  };
  original.models.completeSimple = async () => {
    titles++;
    return {
      ...answer,
      content: [{ type: 'text', text: 'Original provider title' }],
    };
  };
  const runtime = new SerisRuntime({
    modelSettings: settings,
    ...original,
    tools: new ToolRegistry(),
    skills: {},
    sessionsRoot: join(dir, 'sessions'),
    cwd: join(dir, 'workspace'),
    buildSystemPrompt: async () => {
      await gate;
      return 'Fixture';
    },
  });
  await runtime.init();
  t.after(async()=>{await runtime.dispose();await rm(dir,{recursive:true,force:true});});
  const session = await runtime.createSession();
  const run = runtime.startPrompt(session.id, 'Original question');
  await runtime.updateModelSettings(
    'save',
    connection({
      name: 'New',
      provider: 'local',
      requiresKey: false,
      modelId: 'new-model',
    }),
  );
  const newer = settings.config().connections.at(-1);
  await runtime.updateModelSettings('select', {
    connectionId: newer.id,
    modelId: newer.modelId,
  });
  release();
  await run.done;
  for (let i = 0; i < 100 && !titles; i++)
    await new Promise((r) => setTimeout(r, 5));
  assert.equal(oldCalls, 1);
  assert.equal(titles, 1);
  assert.equal(runtime.runState(session.id).model.modelId, 'fixture');
  assert.equal(runtime.modelConfig().selected.modelId, 'new-model');
  assert.equal(runtime.runState(session.id).status, 'completed');
});

test('a locked credential store leaves Settings accessible without discarding saved metadata', async (t) => {
  const { settings, file } = await setup(t);
  await settings.save(connection({ apiKey: 'fixture-key' }));
  const before = await readFile(file, 'utf8');
  const locked = {
    storage: 'keychain',
    read: async () => {
      throw new Error('Locked');
    },
    write: async () => {
      throw new Error('Locked');
    },
    delete: async () => {
      throw new Error('Locked');
    },
  };
  const restarted = new ModelSettings(file, locked, {});
  await restarted.init();
  assert.equal(restarted.config().configured, false);
  assert.equal(restarted.config().credentialError, true);
  assert.equal(restarted.config().connections.length, 1);
  assert.equal(await readFile(file, 'utf8'), before);
});
