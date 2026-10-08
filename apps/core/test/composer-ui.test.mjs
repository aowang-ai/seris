import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startGateway } from '../dist/gateway/server.js';
import { answer, call, marketsFixture, until } from './markets-fixture.mjs';
import { defineTool } from '../dist/tools/registry.js';

const staticRoot = fileURLToPath(new URL('../../desktop-ui/dist/', import.meta.url));

async function composerPage(t, responses = []) {
  const { runtime, service, tools } = await marketsFixture(t, responses);
  const gateway = await startGateway({ runtime, markets: service, staticRoot });
  t.after(() => gateway.close());
  const browser = await chromium.launch({ headless: true, ...(process.env.SERIS_BROWSER_PATH ? { executablePath: process.env.SERIS_BROWSER_PATH } : { channel: 'chrome' }) });
  t.after(() => browser.close());
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1280, height: 840 } });
  await page.goto(gateway.launchUrl);
  await page.getByText('已连接', { exact: true }).waitFor();
  return { page, runtime, tools };
}

test('composer permission selection allows repeated saves, persists after reload, and releases a waiting approval', async t => {
  const { page, runtime, tools } = await composerPage(t, [
    call('strategy_save_draft', { variant: 1 }, 'save-1'),
    call('strategy_save_draft', { variant: 2 }, 'save-2'),
    answer([{ type: 'text', text: 'Two variants saved' }]),
    call('strategy_save_draft', { variant: 3 }, 'save-3'),
    answer([{ type: 'text', text: 'Third variant saved' }]),
  ]);
  let executions = 0, prompts = 0;
  tools.register(defineTool({ name: 'strategy_save_draft', category: 'workspace', approval: 'ask', description: 'Permission UI writer',
    parameters: { type: 'object', properties: { variant: { type: 'number' } } }, execute() { return { saved: ++executions }; } }));
  page.on('request', request => { if (/\/api\/sessions\/[^/]+\/prompt$/.test(request.url()) && request.method() === 'POST') prompts++; });
  const input = page.getByLabel('消息', { exact: true });
  const picker = page.getByRole('combobox', { name: '行动权限', exact: true });
  const select = async label => {
    await picker.click();
    await page.getByRole('option', { name: new RegExp(`^${label}(?:\\s|$)`) }).click();
    const triggerLabel = label === '任何行动都允许' ? '全部允许' : label;
    await until(async () => (await picker.textContent()).includes(triggerLabel) && !(await picker.isDisabled()));
  };
  assert.match(await picker.textContent(), /逐次确认/);
  await input.fill('连续保存两个策略');
  await select('任何行动都允许');
  assert.equal(await input.inputValue(), '连续保存两个策略');
  assert.equal(prompts, 0, 'the permission picker must not submit the form');
  await input.press('Enter');
  await page.getByRole('region', { name: '对话内容', exact: true }).getByText('Two variants saved', { exact: true }).waitFor();
  assert.equal(executions, 2);
  assert.equal(await page.locator('.chat-approval').count(), 0);
  const sessionId = (await runtime.listSessions())[0].id;
  assert.equal((await runtime.listSessions())[0].approvalMode, 'allow-all');
  await page.reload();
  await until(async () => (await picker.textContent()).includes('全部允许'));
  await select('逐次确认');
  await input.fill('保存第三个策略');
  await input.press('Enter');
  await page.getByRole('button', { name: '允许一次', exact: true }).waitFor();
  assert.equal(executions, 2);
  assert.equal(runtime.approvals.list(sessionId).length, 1);
  await select('任何行动都允许');
  await page.getByRole('region', { name: '对话内容', exact: true }).getByText('Third variant saved', { exact: true }).waitFor();
  assert.equal(executions, 3);
  assert.equal(await page.locator('.chat-approval').count(), 0);
  assert.equal(runtime.approvals.list(sessionId).length, 0);
  assert.equal(prompts, 2);
  await page.getByRole('button', { name: '＋ 新建', exact: true }).click();
  await until(async () => (await picker.textContent()).includes('逐次确认'));
  const chats = await runtime.listSessions();
  assert.equal(chats.find(session => session.id === sessionId).approvalMode, 'allow-all');
  assert.equal(chats.find(session => session.id !== sessionId).approvalMode, 'ask');

  // The same control remains usable in the narrow Markets composer.
  await page.setViewportSize({ width: 960, height: 720 });
  await page.getByRole('button', { name: '市场', exact: true }).click();
  await page.getByLabel('BTC K 线图', { exact: true }).waitFor();
  await page.getByRole('button', { name: '打开市场对话', exact: true }).click();
  await page.getByRole('region', { name: '市场对话', exact: true }).waitFor();
  await select('任何行动都允许');
  const layout = await page.locator('.chat-compact .seris-composer').evaluate(composer => {
    const box = composer.getBoundingClientRect();
    return [...composer.querySelectorAll('.composer-controls button')].filter(button => button.offsetWidth > 0).map(button => {
      const bounds = button.getBoundingClientRect();
      return { label: button.getAttribute('aria-label') ?? button.textContent, fits: bounds.left >= box.left && bounds.right <= box.right && bounds.bottom <= box.bottom };
    });
  });
  assert.ok(layout.every(button => button.fits), JSON.stringify(layout));
});

test('IME candidate confirmation never sends from full Chat or Markets Chat; a subsequent Enter sends once', async t => {
  const { page, runtime } = await composerPage(t);
  let requests = 0;
  page.on('request', request => { if (/\/api\/sessions\/[^/]+\/prompt$/.test(request.url()) && request.method() === 'POST') requests++; });
  for (const compact of [false, true]) {
    if (compact) {
      await page.getByRole('button', { name: '市场', exact: true }).click();
      await page.getByLabel('BTC K 线图', { exact: true }).waitFor();
      const restored = page.waitForResponse(response => /\/api\/sessions\/[^/]+\/snapshot(?:\?|$)/.test(response.url()));
      await page.getByRole('button', { name: '打开市场对话', exact: true }).click();
      await (await restored).finished();
    }
    const input = page.getByLabel('消息', { exact: true });
    const draft = compact ? '中文市场分析' : '中文行情分析';
    const before = requests;
    await input.fill(draft);
    await input.dispatchEvent('compositionstart', { data: '分' });
    // A real browser Enter would implicitly submit the form without the guard.
    await input.press('Enter');
    assert.equal(await input.inputValue(), draft);
    assert.equal(requests, before);
    await input.dispatchEvent('compositionend', { data: '分析' });
    // WebKit can emit compositionend before Enter and clear isComposing, while
    // retaining keyCode=229. Emulate its implicit submit if not cancelled.
    for (const key of [{ isComposing: false, keyCode: 229 }, { isComposing: true, keyCode: 13 }]) {
      const prevented = await input.evaluate((el, key) => {
        const event = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, ...key });
        el.dispatchEvent(event);
        if (!event.defaultPrevented) el.form.requestSubmit();
        return event.defaultPrevented;
      }, key);
      assert.equal(prevented, true, JSON.stringify(key));
      assert.equal(await input.inputValue(), draft);
      assert.equal(requests, before);
    }
    await input.press('Enter');
    await until(async () => requests === before + 1 && (await runtime.listSessions()).some(s => runtime.runState(s.id)?.status === 'completed'));
    const history = await runtime.sessionHistory((await runtime.listSessions())[0].id);
    assert.equal(history.filter(m => m.role === 'user' && m.text === draft).length, 1);
    await until(async () => await input.inputValue() === '');
  }
});

test('model label and chevron stay centered and visible with short and truncated names', async t => {
  const { page } = await composerPage(t);
  let name = 'DeepSeek V4.1 Flash';
  await page.route('**/api/config', route => route.fulfill({ json: {
    connections: [{ id: 'layout', name: 'Layout fixture', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:9/v1', modelId: 'layout-model', configured: true, requiresKey: false, models: [{ id: 'layout-model', name }] }],
    selected: { connectionId: 'layout', modelId: 'layout-model' }, configured: true, credentialStorage: 'memory',
  } }));
  for (const label of ['DeepSeek V4.1 Flash', '中文模型名称很长时也应该保留居中的下拉箭头 '.repeat(4)]) {
    name = label;
    await page.reload();
    const picker = page.locator('.composer-controls').getByRole('combobox', { name: '模型', exact: true });
    await picker.waitFor();
    const layout = await picker.evaluate(el => {
      const label = el.querySelector('span').getBoundingClientRect(), arrow = el.querySelector('svg').getBoundingClientRect(), button = el.getBoundingClientRect();
      return { offset: Math.abs(label.y + label.height / 2 - arrow.y - arrow.height / 2), visible: arrow.width === 14 && arrow.right <= button.right + 0.5, width: button.width };
    });
    assert.ok(layout.offset < 0.5, JSON.stringify(layout));
    assert.equal(layout.visible, true, JSON.stringify(layout));
    assert.ok(layout.width <= 240.5, JSON.stringify(layout));
  }
});
