import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';
import { createSerisRuntime } from '../dist/runtime/createSerisRuntime.js';
import { ModelSettings } from '../dist/runtime/modelSettings.js';
import { MemorySecrets } from '../dist/runtime/credentials.js';
import { startGateway } from '../dist/gateway/server.js';

test('built UI discovers models, saves multiple choices, scopes blank keys, and searches/pins/switches in Chat', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'seris-ui-'));
  process.env.SERIS_DATA_DIR = dir;
  const secrets = new MemorySecrets();
  const modelSettings = new ModelSettings(
    join(dir, '.data/models.json'),
    secrets,
    {},
  );
  const runtime = await createSerisRuntime({
    modelSettings,
    sessionsRoot: join(dir, 'sessions'),
    cwd: join(dir, 'workspace'),
  });
  const gateway = await startGateway({
    runtime,
    staticRoot: fileURLToPath(
      new URL('../../desktop-ui/dist/', import.meta.url),
    ),
  });
  const requests = [];
  const fixtureServer = createServer((req, res) => {
    requests.push({ path: req.url, auth: req.headers.authorization });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        data: [
          { id: 'fixture-a', name: 'Fixture A' },
          { id: 'fixture-b', name: 'Fixture B' },
          { id: 'text-embedding-fixture' },
        ],
      }),
    );
  });
  await new Promise((r) => fixtureServer.listen(0, '127.0.0.1', r));
  const endpoint = `http://127.0.0.1:${fixtureServer.address().port}/v1`;
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.SERIS_BROWSER_PATH
        ? { executablePath: process.env.SERIS_BROWSER_PATH }
        : { channel: 'chrome' }),
    });
    const page = await browser.newPage({
      locale: 'en-US',
      viewport: { width: 1280, height: 900 },
    });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/api/config/local-models', (route) =>
      route.fulfill({
        json: [
          {
            provider: 'ollama',
            baseUrl: 'http://127.0.0.1:11434/v1',
            status: 'ready',
            models: [{ id: 'local-fixture', name: 'Local Fixture' }],
          },
          {
            provider: 'lmstudio',
            baseUrl: 'http://127.0.0.1:1234/v1',
            status: 'unavailable',
            models: [],
          },
        ],
      }),
    );
    await page.goto(gateway.launchUrl);
    await page.getByText('Model setup required', { exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.has('ticket'), false);
    await page
      .getByRole('heading', { name: 'Settings', exact: true })
      .waitFor();
    await page.getByText('1 models found', { exact: true }).waitFor();
    await page
      .getByRole('button', { name: 'Add service', exact: true })
      .click();
    await page
      .getByRole('dialog')
      .getByLabel('Search providers')
      .fill('OpenAI compatible');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'OpenAI compatible', exact: false })
      .click();
    await page
      .getByRole('heading', { name: 'OpenAI compatible', exact: true })
      .waitFor();
    await page.getByLabel('API endpoint', { exact: true }).fill(endpoint);
    await page
      .getByLabel('API key', { exact: true })
      .fill('fixture-not-real-key');
    await page
      .getByRole('button', { name: 'Fetch models', exact: true })
      .click();
    await page.getByLabel('Fixture A', { exact: true }).waitFor();
    await page.getByLabel('Fixture B', { exact: true }).check();
    assert.equal(
      await page.getByText('text-embedding-fixture', { exact: true }).count(),
      0,
    );
    await page.getByLabel('Service name', { exact: true }).fill('Custom AI');
    await page.getByRole('tab', { name: 'Model parameters', exact: true }).click();
    await page.getByLabel('Context window', { exact: true }).fill('65536');
    await page.getByLabel('Max output tokens', { exact: true }).fill('0');
    await page.getByRole('tab', { name: 'Connection and models', exact: true }).click();
    assert.equal(await page.getByLabel('Service name', { exact: true }).inputValue(), 'Custom AI');
    // Invalid fields on the other tab must be revealed before reporting validation.
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    assert.equal(await page.getByRole('tab', { name: 'Model parameters', exact: true }).getAttribute('aria-selected'), 'true');
    await page.getByLabel('Max output tokens', { exact: true }).fill('4096');
    await page.getByRole('tab', { name: 'Model parameters', exact: true }).press('ArrowLeft');
    assert.equal(await page.getByLabel('API key', { exact: true }).inputValue(), 'fixture-not-real-key');
    await page
      .getByRole('button', { name: 'Save changes', exact: true })
      .click();
    await page.getByText('Connection saved', { exact: true }).waitFor();
    assert.equal(runtime.configured, true);
    const id = runtime.modelConfig().selected.connectionId;
    assert.equal(runtime.modelConfig().connections[0].models.length, 2);
    assert.equal(runtime.modelConfig().connections[0].contextWindow, 65536);
    assert.equal(runtime.modelConfig().connections[0].maxTokens, 4096);
    assert.equal(requests[0].auth, 'Bearer fixture-not-real-key');
    const stored = await readFile(join(dir, '.data/models.json'), 'utf8');
    assert.equal(stored.includes('fixture-not-real-key'), false);
    assert.equal(
      await page.evaluate(() =>
        JSON.stringify(localStorage).includes('fixture-not-real-key'),
      ),
      false,
    );
    // Editing a saved service reuses its key only for the same endpoint.
    assert.equal(
      await page.getByLabel('API key', { exact: true }).inputValue(),
      '',
    );
    await page
      .getByRole('button', { name: 'Fetch models', exact: true })
      .click();
    await page.getByText('2 models found', { exact: true }).waitFor();
    assert.equal(requests.at(-1).auth, 'Bearer fixture-not-real-key');
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    await page.getByRole('button', { name: '+ New', exact: true }).click();
    await page
      .locator('aside button')
      .filter({ hasText: 'New chat' })
      .first()
      .waitFor();
    const sessionId = (await runtime.listSessions())[0].id;
    await page
      .locator('.seris-composer > input')
      .fill('Keep this unsent draft');
    await page.getByRole('combobox', { name: 'Model', exact: true }).click();
    await page
      .getByRole('combobox', { name: 'Search models', exact: true })
      .fill('fixture-b');
    await page
      .getByRole('option')
      .filter({ hasText: 'Fixture B' })
      .getByRole('button', { name: 'Pin model', exact: true })
      .click();
    assert.equal(
      runtime.modelConfig().selected.modelId,
      'fixture-a',
      'pinning must not change the current model',
    );
    await page
      .getByRole('combobox', { name: 'Search models', exact: true })
      .press('Enter');
    await page.waitForFunction(() =>
      document
        .querySelector('.composer-controls')
        ?.textContent.includes('Fixture B'),
    );
    assert.equal(runtime.modelConfig().selected.modelId, 'fixture-b');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Custom AI', exact: true }).click();
    await page
      .getByRole('button', { name: 'Add custom model', exact: true })
      .click();
    await page
      .getByLabel('Custom model ID', { exact: true })
      .fill('updated-fixture');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const modelButton = page
      .locator('form')
      .getByRole('combobox', { name: 'Model', exact: true });
    await modelButton.click();
    await page
      .getByRole('option')
      .filter({ hasText: 'updated-fixture' })
      .click();
    const configurationError = 'Fixture configuration failure\n' + 'Diagnostic context for the failed save. '.repeat(20);
    await page.route('**/api/config/connections', (route) =>
      route.fulfill({
        status: 500,
        json: { error: configurationError },
      }),
    );
    await page
      .getByRole('button', { name: 'Save changes', exact: true })
      .click();
    await page
      .getByRole('alert')
      .filter({ hasText: 'Unable to update model settings' })
      .waitFor();
    const detailsButton = page.getByRole('button', { name: 'View details', exact: true });
    await detailsButton.click();
    assert.equal(await page.getByRole('dialog').locator('pre').innerText(), configurationError);
    await page.getByRole('dialog').getByRole('button', { name: 'copy', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'copied', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(await detailsButton.evaluate((el) => el === document.activeElement), true);
    await page.unroute('**/api/config/connections');
    await page
      .getByRole('button', { name: 'Save changes', exact: true })
      .click();
    await page.getByText('Connection saved', { exact: true }).waitFor();
    assert.equal(await secrets.read(id), 'fixture-not-real-key');
    assert.equal(runtime.modelConfig().selected.modelId, 'updated-fixture');
    // An unavailable listing must not trap navigation or overwrite another service's draft.
    let stalledRoute;
    await page.route('**/api/config/discover', (route) => {
      stalledRoute = route;
    });
    await page
      .getByRole('button', { name: 'Fetch models', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Fetching…', exact: true })
      .waitFor();
    await page.getByRole('button', { name: 'Anthropic', exact: true }).click();
    await page
      .getByRole('heading', { name: 'Anthropic', exact: true })
      .waitFor();
    await stalledRoute
      .fulfill({ json: { models: [{ id: 'late-model', name: 'Late Model' }] } })
      .catch(() => {});
    await page.unroute('**/api/config/discover');
    assert.equal(
      await page.getByText('Late Model', { exact: true }).count(),
      0,
    );
    await page.getByRole('button', { name: 'Ollama', exact: false }).click();
    await page.getByLabel('Local Fixture', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('API key', { exact: true }).count(), 0);
    await page
      .getByRole('button', { name: 'Save changes', exact: true })
      .click();
    await page.getByRole('heading', { name: 'Ollama', exact: true }).waitFor();
    await page.waitForFunction(() =>
      document
        .querySelector('nav[aria-label="Services"]')
        ?.textContent.includes('Ollama'),
    );
    await page
      .getByRole('combobox', { name: 'Language', exact: true })
      .selectOption('zh-CN');
    await page.getByRole('heading', { name: '设置', exact: true }).waitFor();
    await page.getByText('已启用 1 个模型', { exact: true }).waitFor();
    await page.getByText('服务已保存', { exact: true }).waitFor();
    await page.screenshot({ path: '/tmp/seris-model-discovery-settings.png' });
    await page
      .getByRole('combobox', { name: '语言', exact: true })
      .selectOption('en');
    await page.route('**/api/config/discover', async (route) => {
      if (route.request().postDataJSON().provider === 'lmstudio')
        return route.fulfill({
          status: 400,
          json: { error: 'Model service unavailable' },
        });
      await route.continue();
    });
    await page.getByRole('button', { name: 'LM Studio', exact: false }).click();
    await page
      .getByRole('alert')
      .filter({ hasText: 'Start the local model server, then try again.' })
      .waitFor();
    assert.equal(
      await page
        .getByRole('button', { name: 'Save changes', exact: true })
        .isDisabled(),
      true,
    );
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    assert.equal(
      await page.locator('.seris-composer > input').inputValue(),
      'Keep this unsent draft',
    );
    await page.getByRole('combobox', { name: 'Model', exact: true }).click();
    await page.getByText('Favorites', { exact: true }).waitFor();
    await page
      .getByRole('combobox', { name: 'Search models', exact: true })
      .fill('local');
    await page.getByRole('option').filter({ hasText: 'Local Fixture' }).click();
    await page.waitForFunction(() =>
      document
        .querySelector('.composer-controls')
        ?.textContent.includes('Local Fixture'),
    );
    assert.equal(runtime.modelConfig().selected.modelId, 'local-fixture');
    assert.equal((await runtime.listSessions())[0].id, sessionId);
    await page.reload();
    await page.getByText('Connected', { exact: true }).waitFor();
    await page.getByRole('combobox', { name: 'Model', exact: true }).click();
    await page.getByText('Favorites', { exact: true }).waitFor();
    assert.notEqual(
      await page
        .getByRole('listbox')
        .evaluate((el) => getComputedStyle(el.parentElement).backgroundColor),
      'rgba(0, 0, 0, 0)',
    );
    await page.waitForTimeout(250);
    await page.screenshot({ path: '/tmp/seris-model-discovery-picker.png' });
    assert.deepEqual(errors, []);
    assert.equal((await runtime.listSessions()).length, 1);
  } finally {
    await browser?.close();
    await runtime.dispose();
    await gateway.close();
    fixtureServer.closeAllConnections();
    await new Promise((r) => fixtureServer.close(r));
    await rm(dir, { recursive: true, force: true });
  }
});
