import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startGateway } from '../dist/gateway/server.js';
import {
  marketsFixture,
  call,
  answer,
  deferred,
  until,
} from './markets-fixture.mjs';
import { defineTool } from '../dist/tools/registry.js';
import { toolContext } from '../dist/runtime/toolContext.js';
const staticRoot = fileURLToPath(
  new URL('../../desktop-ui/dist/', import.meta.url),
);
test('Markets renders candles, preserves Chat and rejects a late BTC view action after switching to NVDA', async (t) => {
  const { runtime, service, tools } = await marketsFixture(t, [
    call('fixture_wait'),
    answer([{ type: 'text', text: 'BTC analysis complete' }]),
    call('market_set_view', { interval: '1w' }, 'week-view'),
    answer([{ type: 'text', text: 'Weekly analysis' }]),
    call('market_price_line', { price: 155, label: '观察 155' }, 'price-line'),
    answer([{ type: 'text', text: 'Optional price level' }]),
  ]);
  const wait = deferred();
  let captured;
  tools.register(
    defineTool({
      name: 'fixture_wait',
      category: 'market-data',
      description: 'fixture',
      parameters: { type: 'object', properties: {} },
      async execute() {
        captured = structuredClone(toolContext.getStore().marketContext);
        await wait.promise;
        const next = service.capture({
          viewId: 'late-btc-view',
          dataRef: (await service.chart(captured.instrument, '1w')).id,
        });
        return {
          marketAction: {
            id: 'late-btc-action',
            kind: 'view',
            originViewId: captured.viewId,
            context: next,
            label: '查看旧 BTC 分析',
          },
        };
      },
    }),
  );
  const gateway = await startGateway({ runtime, markets: service, staticRoot });
  t.after(() => gateway.close());
  let browser;
  try {
    try {
      browser = await chromium.launch({
        headless: true,
        ...(process.env.SERIS_BROWSER_PATH
          ? { executablePath: process.env.SERIS_BROWSER_PATH }
          : { channel: 'chrome' }),
      });
    } catch (e) {
      if (String(e).includes("Executable doesn't exist")) {
        t.skip('Install Chrome for browser regressions');
        return;
      }
      throw e;
    }
    const page = await browser.newPage({
      locale: 'zh-CN',
      viewport: { width: 1280, height: 840 },
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(gateway.launchUrl);
    await page.getByText('已连接', { exact: true }).waitFor();
    await page.getByRole('button', { name: '市场', exact: true }).click();
    await page.getByLabel('BTC K 线图', { exact: true }).waitFor();
    assert.ok((await page.locator('.market-chart canvas').count()) > 0);
    await page.getByRole('button', { name: '1小时', exact: true }).click();
    await until(
      async () =>
        (await page
          .getByRole('button', { name: '1小时', exact: true })
          .getAttribute('aria-pressed')) === 'true',
    );
    await page.getByLabel('BTC K 线图', { exact: true }).waitFor();
    await page
      .getByRole('button', { name: '打开市场对话', exact: true })
      .click();
    await page.getByRole('region', { name: '市场对话', exact: true }).waitFor();
    await page.getByRole('region', { name: '市场对话', exact: true }).waitFor();
    await page.getByLabel('消息', { exact: true }).fill('Analyze BTC');
    await page.getByRole('button', { name: '发送 ↑', exact: true }).click();
    await until(() => captured);
    assert.equal(captured.instrument.id, 'hyperliquid:BTC');
    assert.equal(captured.interval, '1h');
    assert.ok(captured.visibleRange);
    await page.getByRole('button', { name: '收起市场对话' }).last().click();
    assert.equal(
      runtime.runState((await runtime.listSessions())[0].id).status,
      'running',
    );
    // The watchlist becomes visible once Chat is collapsed at this width.
    await page.locator('.watchlist-select').filter({ hasText: 'NVDA' }).click();
    await page.getByLabel('NVDA K 线图', { exact: true }).waitFor();
    wait.resolve();
    await until(
      async () =>
        runtime.runState((await runtime.listSessions())[0].id).status ===
        'completed',
    );
    await page.waitForTimeout(100);
    assert.equal(
      await page.getByLabel('BTC K 线图', { exact: true }).count(),
      0,
    );
    await page
      .getByRole('button', { name: '打开市场对话', exact: true })
      .click();
    await page.getByRole('region', { name: '市场对话', exact: true }).waitFor();
    await page.getByRole('region', { name: '市场对话', exact: true }).waitFor();
    await page.getByText('BTC analysis complete', { exact: true }).waitFor();
    const resultButton = page.getByRole('button', { name: '已调用 fixture_wait', exact: true });
    await resultButton.click();
    assert.equal(await resultButton.getAttribute('aria-expanded'), 'true');
    assert.match(await page.locator('.chat-tool-output pre').innerText(), /late-btc-action/);
    assert.equal(await page.getByRole('dialog').count(), 0);
    await resultButton.press('Enter');
    assert.equal(await resultButton.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('.chat-tool-output pre').count(), 0);
    assert.equal(await resultButton.evaluate((el) => el === document.activeElement), true);
    assert.ok(
      await page
        .getByRole('button', {
          name: '查看 BTC · Hyperliquid · 永续 · 1周 ↗',
          exact: true,
        })
        .count(),
    );
    assert.match(await page.locator('.composer-context').textContent(), /NVDA/);
    await page.getByLabel('消息', { exact: true }).fill('Keep Markets draft');
    await page.getByTitle('展开到完整对话').click();
    assert.equal(
      await page.getByLabel('消息', { exact: true }).inputValue(),
      'Keep Markets draft',
    );
    await page.getByRole('button', { name: '市场', exact: true }).click();
    await page.getByRole('region', { name: '市场对话', exact: true }).waitFor();
    assert.equal(
      await page.getByLabel('消息', { exact: true }).inputValue(),
      'Keep Markets draft',
    );
    await page.getByRole('tab', { name: '资讯', exact: true }).click();
    await page.getByLabel('消息', { exact: true }).fill('换成周线再分析');
    await page.getByRole('button', { name: '发送 ↑', exact: true }).click();
    await page.getByText('Weekly analysis', { exact: true }).waitFor();
    await until(
      async () =>
        (await page
          .getByRole('tab', { name: '图表', exact: true })
          .getAttribute('aria-selected')) === 'true',
    );
    await until(
      async () =>
        (await page
          .getByRole('button', { name: '1周', exact: true })
          .getAttribute('aria-pressed')) === 'true',
    );
    assert.match(
      await page.locator('.composer-context').textContent(),
      /NVDA.*1周/,
    );
    await page.getByLabel('消息', { exact: true }).fill('标注观察价位');
    await page.getByRole('button', { name: '发送 ↑', exact: true }).click();
    await page.getByText('Optional price level', { exact: true }).waitFor();
    await page.getByRole('button', { name: '观察 155 ↗', exact: true }).click();
    await page.getByLabel('NVDA K 线图', { exact: true }).waitFor();
    await page.getByRole('tab', { name: /^提醒/ }).click();
    await page
      .getByRole('button', { name: '＋ 新建提醒', exact: true })
      .click();
    await page.getByLabel('提醒阈值').fill('200');
    await page.getByRole('button', { name: '保存提醒', exact: true }).click();
    await page.getByText('NVDA 价格 ≥ 200 USD', { exact: true }).waitFor();
    assert.equal(service.alerts().length, 1);
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await page.getByRole('button', { name: '恢复', exact: true }).waitFor();
    assert.equal(service.alerts()[0].status, 'paused');
    await page.getByRole('button', { name: '收起市场对话' }).last().click();
    await page.getByRole('tab', { name: '图表', exact: true }).click();
    // Shift-click selects a range, rather than changing context on ordinary hover.
    const plot = await page.locator('.market-chart').boundingBox();
    await page.keyboard.down('Shift');
    await page.mouse.click(plot.x + plot.width * 0.35, plot.y + 80);
    await page.mouse.click(plot.x + plot.width * 0.6, plot.y + 80);
    await page.keyboard.up('Shift');
    await page.getByRole('button', { name: '清除区间', exact: true }).waitFor();
    await page.screenshot({ path: '/tmp/seris-markets-test.png' });
    await page.setViewportSize({ width: 960, height: 640 });
    await page
      .getByRole('button', { name: '打开市场对话', exact: true })
      .click();
    await page.getByRole('region', { name: '市场对话', exact: true }).waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
      false,
    );
    await page.getByLabel('消息', { exact: true }).fill('解释选中区间');
    await page.getByRole('button', { name: '发送 ↑', exact: true }).click();
    await page
      .getByText('Fixture analysis complete', { exact: true })
      .waitFor();
    const rangeMessage = (
      await runtime.sessionHistory((await runtime.listSessions())[0].id)
    )
      .filter((m) => m.role === 'user')
      .at(-1);
    assert.ok(
      rangeMessage.marketContext.selectedRange.to >
        rangeMessage.marketContext.selectedRange.from,
    );
    assert.ok(
      rangeMessage.marketContext.annotations.some(
        (a) => a.label === '观察 155',
      ),
    );
    await page.reload();
    await page.getByText('已连接', { exact: true }).waitFor();
    await page.getByRole('button', { name: '市场', exact: true }).click();
    await page
      .getByRole('button', { name: '打开市场对话', exact: true })
      .click();
    await page.getByRole('region', { name: '市场对话', exact: true }).waitFor();
    await page.getByRole('region', { name: '市场对话', exact: true }).waitFor();
    await page.getByText('BTC analysis complete', { exact: true }).waitFor();
    assert.equal((await runtime.listSessions()).length, 1);
    assert.deepEqual(errors, []);
  } finally {
    wait.resolve();
    await browser?.close();
  }
});

test('Markets separates search from watching, preserves chart state across tabs and keeps narrow navigation accessible', async (t) => {
  const { runtime, service, engine } = await marketsFixture(t);
  const instruments = service.watchlist();
  const btc = instruments.find((i) => i.symbol === 'BTC');
  const nvda = instruments.find((i) => i.symbol === 'NVDA');
  service.remove(nvda.id);
  for (const instrument of [btc, nvda]) {
    const alert = service.createAlert(
      {
        instrument,
        metric: 'price',
        direction: 'above',
        threshold: 1,
        once: true,
      },
      `fixture-${instrument.symbol}`,
    );
    await engine.runStrategy(alert.id);
  }
  assert.equal(service.notifications().length, 2);
  const gateway = await startGateway({ runtime, markets: service, staticRoot });
  t.after(() => gateway.close());
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.SERIS_BROWSER_PATH
        ? { executablePath: process.env.SERIS_BROWSER_PATH }
        : { channel: 'chrome' }),
    });
    const page = await browser.newPage({
      locale: 'zh-CN',
      viewport: { width: 1280, height: 840 },
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(gateway.launchUrl);
    await page.getByText('已连接', { exact: true }).waitFor();
    await page.getByRole('button', { name: '市场', exact: true }).click();
    await page.getByLabel('BTC K 线图', { exact: true }).waitFor();
    await page
      .getByRole('button', { name: '收起主侧边栏', exact: true })
      .click();
    const sidebarFrames = await page.evaluate(async () => {
      const widths = [];
      for (let i = 0; i < 24; i++) {
        await new Promise(requestAnimationFrame);
        widths.push(
          document
            .querySelector('[aria-label="主侧边栏"]')
            .getBoundingClientRect().width,
        );
      }
      return widths;
    });
    assert.ok(
      sidebarFrames.some((w) => w > 52 && w < 232),
      'sidebar must animate through intermediate widths',
    );
    await until(
      async () =>
        (await page.getByLabel('主侧边栏', { exact: true }).boundingBox())
          .width === 52,
    );
    const originalCount = service.watchlist().length;
    const search = page.getByRole('button', { name: '搜索标的', exact: true });
    await search.click();
    await page.getByRole('dialog', { name: '搜索标的', exact: true }).waitFor();
    await page
      .getByRole('combobox', { name: '搜索标的', exact: true })
      .fill('NVDA');
    await page.getByRole('option').filter({ hasText: 'NVDA' }).waitFor();
    await page.keyboard.press('Enter');
    await page.getByLabel('NVDA K 线图', { exact: true }).waitFor();
    assert.equal(
      service.watchlist().length,
      originalCount,
      'opening a search result must not add it',
    );
    await page
      .getByRole('button', { name: '关注当前标的', exact: true })
      .click();
    await page
      .getByRole('button', { name: '取消关注当前标的', exact: true })
      .waitFor();
    assert.equal(service.watchlist().length, originalCount + 1);
    await page
      .getByRole('button', { name: '取消关注当前标的', exact: true })
      .click();
    await page
      .getByRole('button', { name: '关注当前标的', exact: true })
      .waitFor();
    assert.equal(
      await page.getByLabel('NVDA K 线图').count(),
      1,
      'unwatching preserves the chart',
    );
    await page.locator('.watchlist-select').filter({ hasText: 'BTC' }).click();
    await search.click();
    await page.getByRole('dialog', { name: '搜索标的', exact: true }).waitFor();
    await page
      .getByRole('combobox', { name: '搜索标的', exact: true })
      .fill('NVDA');
    await page
      .getByRole('button', { name: '关注 NVDA · 美股', exact: true })
      .click();
    await page
      .getByRole('button', { name: '取消关注 NVDA · 美股', exact: true })
      .waitFor();
    assert.match(await page.locator('.market-heading h1').textContent(), /BTC/);
    await page.screenshot({ path: '/tmp/seris-markets-search.png' });
    const exit = await page.evaluate(() => {
      const popup = document.querySelector('.market-modal');
      return new Promise((resolve, reject) => {
        let retainedDuringExit = false;
        const timeout = setTimeout(() => {
          observer.disconnect();
          reject(new Error('Search popup did not finish closing'));
        }, 5000);
        const observer = new MutationObserver(() => {
          if (popup.hasAttribute('data-ending-style') && popup.isConnected) {
            retainedDuringExit = true;
          }
          if (!popup.isConnected) {
            clearTimeout(timeout);
            observer.disconnect();
            resolve({ retainedDuringExit });
          }
        });
        observer.observe(document.body, {
          attributes: true,
          attributeFilter: ['data-ending-style'],
          childList: true,
          subtree: true,
        });
        popup.querySelector('button[aria-label="关闭搜索标的"]').click();
      });
    });
    assert.equal(
      exit.retainedDuringExit,
      true,
      'popup stays mounted through exit',
    );
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(
      await search.evaluate((el) => el === document.activeElement),
      true,
    );
    // Search supports multiple results, keyboard selection and a local retry.
    await search.click();
    await page.getByRole('dialog', { name: '搜索标的', exact: true }).waitFor();
    await page
      .getByRole('combobox', { name: '搜索标的', exact: true })
      .fill('A');
    await until(async () => (await page.getByRole('option').count()) === 2);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.getByLabel('AAPL K 线图').waitFor();
    await search.click();
    await page.getByRole('dialog', { name: '搜索标的', exact: true }).waitFor();
    await page.route('**/api/markets/search?q=ERROR', (route) =>
      route.fulfill({ status: 503, body: 'fixture unavailable' }),
    );
    await page
      .getByRole('combobox', { name: '搜索标的', exact: true })
      .fill('ERROR');
    await page.getByText('搜索暂不可用，请重试。', { exact: true }).waitFor();
    await page.unroute('**/api/markets/search?q=ERROR');
    await page.getByRole('button', { name: '重试搜索', exact: true }).click();
    await page
      .getByText('没有找到匹配标的，试试其他代码或名称。', { exact: true })
      .waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.watchlist-select').filter({ hasText: 'NVDA' }).click();
    await page.getByRole('button', { name: '1小时', exact: true }).click();
    await page.getByLabel('NVDA K 线图').waitFor();
    const plot = await page.locator('.market-chart').boundingBox();
    await page.keyboard.down('Shift');
    await page.mouse.click(plot.x + plot.width * 0.35, plot.y + 80);
    await page.mouse.click(plot.x + plot.width * 0.6, plot.y + 80);
    await page.keyboard.up('Shift');
    await page.getByRole('button', { name: '清除区间', exact: true }).waitFor();
    await page
      .getByRole('button', { name: '打开市场对话', exact: true })
      .click();
    await page.getByRole('region', { name: '市场对话', exact: true }).waitFor();
    const send = async (text, count) => {
      await page.getByLabel('消息', { exact: true }).fill(text);
      await page.getByRole('button', { name: '发送 ↑', exact: true }).click();
      await until(async () => {
        const sessions = await runtime.listSessions();
        return (
          sessions[0] &&
          (await runtime.sessionHistory(sessions[0].id)).filter(
            (m) => m.role === 'user',
          ).length === count &&
          runtime.runState(sessions[0].id).status === 'completed'
        );
      });
      return (
        await runtime.sessionHistory((await runtime.listSessions())[0].id)
      )
        .filter((m) => m.role === 'user')
        .at(-1).marketContext;
    };
    const before = await send('Before switching tabs', 1);
    await page.getByRole('tab', { name: '资讯', exact: true }).click();
    assert.equal(await page.locator('.market-chart').isVisible(), false);
    await page
      .getByRole('button', { name: '问 Seris ↗', exact: true })
      .first()
      .click();
    await until(async () =>
      (await page.getByLabel('消息', { exact: true }).inputValue()).includes(
        'Fixture market news',
      ),
    );
    const draft = await page.getByLabel('消息', { exact: true }).inputValue();
    assert.match(draft, /NVDA/);
    assert.match(draft, /Fixture market news/);
    assert.match(draft, /https:\/\/example.com\/news/);
    assert.match(
      await page.locator('.composer-context').textContent(),
      /NVDA.*1小时/,
    );
    await page.getByRole('tab', { name: /^提醒/ }).click();
    assert.equal(
      await page.locator('.market-notification').count(),
      1,
      'only current instrument notifications belong in its detail tab',
    );
    assert.match(
      await page.locator('.market-notification').textContent(),
      /NVDA/,
    );
    await page.getByRole('tab', { name: '图表', exact: true }).click();
    await page.getByRole('button', { name: '清除区间', exact: true }).waitFor();
    assert.equal(
      await page.getByLabel('消息', { exact: true }).inputValue(),
      draft,
    );
    const after = await send('After switching tabs', 2);
    assert.deepEqual(after.selectedRange, before.selectedRange);
    assert.deepEqual(after.visibleRange, before.visibleRange);
    assert.equal(after.interval, '1h');
    await page.getByRole('tab', { name: /^提醒/ }).click();
    await page
      .getByRole('button', { name: '＋ 新建提醒', exact: true })
      .click();
    await page.getByLabel('提醒阈值').fill('175');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(service.alerts().length, 2, 'Escape cancels without saving');
    await page.setViewportSize({ width: 960, height: 640 });
    await page
      .getByRole('button', { name: '展开关注列表', exact: true })
      .click();
    assert.equal(
      await page.getByLabel('关注列表', { exact: true }).isVisible(),
      true,
    );
    await page.locator('.watchlist-select').filter({ hasText: 'BTC' }).click();
    assert.equal(
      await page
        .getByRole('complementary', { name: '关注列表', exact: true })
        .count(),
      0,
    );
    await page.getByLabel('BTC K 线图').waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
      false,
    );
    await page.screenshot({ path: '/tmp/seris-markets-compact.png' });
    await page.reload();
    await page.getByText('已连接', { exact: true }).waitFor();
    assert.equal(
      (await page.getByLabel('主侧边栏', { exact: true }).boundingBox()).width,
      52,
      'sidebar preference survives reload',
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
  }
});

test('drawer motion survives rapid reversal and resizing, and reduced motion keeps dialogs usable', async (t) => {
  const { runtime, service } = await marketsFixture(t);
  const gateway = await startGateway({ runtime, markets: service, staticRoot });
  t.after(() => gateway.close());
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.SERIS_BROWSER_PATH
        ? { executablePath: process.env.SERIS_BROWSER_PATH }
        : { channel: 'chrome' }),
    });
    const page = await browser.newPage({
      locale: 'zh-CN',
      viewport: { width: 1280, height: 840 },
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(gateway.launchUrl);
    await page.getByText('已连接', { exact: true }).waitFor();
    await page.getByRole('button', { name: '市场', exact: true }).click();
    await page.getByLabel('BTC K 线图').waitFor();
    await page
      .getByRole('button', { name: '打开市场对话', exact: true })
      .click();
    await page.getByRole('region', { name: '市场对话', exact: true }).waitFor();
    await page
      .getByLabel('消息', { exact: true })
      .fill('Keep draft through rapid toggles');
    await page.getByRole('button', { name: '收起市场对话' }).last().click();
    await page
      .getByRole('button', { name: '打开市场对话', exact: true })
      .click();
    await page.getByRole('region', { name: '市场对话', exact: true }).waitFor();
    await until(
      async () =>
        Math.abs(
          (await page.locator('.market-chat-shell').boundingBox()).width - 380,
        ) < 1,
    );
    assert.equal(
      await page.getByLabel('消息', { exact: true }).inputValue(),
      'Keep draft through rapid toggles',
    );
    assert.equal((await runtime.listSessions()).length, 1);
    const handle = await page
      .getByRole('separator', { name: '调整市场对话宽度' })
      .boundingBox();
    await page.mouse.move(handle.x + 2, handle.y + 100);
    await page.mouse.down();
    await page.mouse.move(handle.x - 60, handle.y + 100, { steps: 4 });
    assert.ok(
      (await page.locator('.market-chat-shell').boundingBox()).width > 430,
    );
    assert.match(
      await page.locator('.market-chat-shell').getAttribute('class'),
      /is-resizing/,
    );
    await page.mouse.up();
    assert.equal(
      (await page.locator('.market-chat-shell').getAttribute('class')).includes(
        'is-resizing',
      ),
      false,
    );
    assert.equal(
      await page.getByLabel('消息', { exact: true }).inputValue(),
      'Keep draft through rapid toggles',
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    await page.getByText('已连接', { exact: true }).waitFor();
    await page.getByRole('button', { name: '市场', exact: true }).click();
    await page.getByLabel('BTC K 线图').waitFor();
    assert.equal(
      await page
        .getByLabel('主侧边栏', { exact: true })
        .evaluate((el) => getComputedStyle(el).transitionDuration),
      '0s',
    );
    await page.getByRole('button', { name: '搜索标的', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '搜索标的', exact: true });
    await dialog.waitFor();
    assert.ok(
      (await dialog.evaluate((el) => getComputedStyle(el).transitionDuration))
        .split(',')
        .every((v) => v.trim() === '0s'),
    );
    await page
      .getByRole('combobox', { name: '搜索标的', exact: true })
      .fill('BTC');
    await page.getByRole('option').filter({ hasText: 'BTC' }).waitFor();
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(
      await page
        .getByRole('button', { name: '搜索标的', exact: true })
        .evaluate((el) => el === document.activeElement),
      true,
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
  }
});

test('ordinary Chat opens Markets only for typed view actions and keeps its conversation', async (t) => {
  const { runtime, service, tools } = await marketsFixture(t, [
    call('get_market_chart'),
    answer([{ type: 'text', text: 'Read-only chart data' }]),
    call(
      'market_set_view',
      { instrumentId: 'us:NVDA.US', interval: '1h' },
      'nvda-view',
    ),
    call(
      'market_set_view',
      { instrumentId: 'hyperliquid:BTC', interval: '1w' },
      'btc-view',
    ),
    answer([{ type: 'text', text: 'BTC chart ready' }]),
    call('fixture_late_view'),
    answer([{ type: 'text', text: 'Deferred chart ready' }]),
    call('fixture_late_tab'),
    answer([{ type: 'text', text: 'Tab-deferred chart ready' }]),
  ]);
  tools.register(
    defineTool({
      name: 'get_market_chart',
      category: 'market-data',
      description: 'fixture read only',
      parameters: { type: 'object', properties: {} },
      execute: () => ({ prices: [] }),
    }),
  );
  const wait = deferred();
  let waiting = false;
  tools.register(
    defineTool({
      name: 'fixture_late_view',
      category: 'market-data',
      description: 'fixture',
      parameters: { type: 'object', properties: {} },
      async execute() {
        const original = toolContext.getStore().marketContext;
        waiting = true;
        await wait.promise;
        const context = service.capture({
          viewId: 'late-chat-view',
          dataRef: (await service.chart(service.instrument('us:NVDA.US'), '1d'))
            .id,
        });
        return {
          marketAction: {
            id: 'late-chat-action',
            kind: 'view',
            originViewId: original.viewId,
            context,
            label: '查看 NVDA 日线',
          },
        };
      },
    }),
  );
  const tabWait = deferred();
  let tabWaiting = false;
  tools.register(
    defineTool({
      name: 'fixture_late_tab',
      category: 'market-data',
      description: 'fixture',
      parameters: { type: 'object', properties: {} },
      async execute() {
        const original = toolContext.getStore().marketContext;
        tabWaiting = true;
        await tabWait.promise;
        const context = service.capture({
          viewId: 'late-tab-view',
          dataRef: (await service.chart(service.instrument('us:NVDA.US'), '1d'))
            .id,
        });
        return {
          marketAction: {
            id: 'late-tab-action',
            kind: 'view',
            originViewId: original.viewId,
            context,
            label: '查看 NVDA 延迟图表',
          },
        };
      },
    }),
  );
  const gateway = await startGateway({ runtime, markets: service, staticRoot });
  t.after(() => gateway.close());
  let browser;
  try {
    try {
      browser = await chromium.launch({
        headless: true,
        ...(process.env.SERIS_BROWSER_PATH
          ? { executablePath: process.env.SERIS_BROWSER_PATH }
          : { channel: 'chrome' }),
      });
    } catch (e) {
      if (String(e).includes("Executable doesn't exist")) {
        t.skip('Install Chrome for browser regressions');
        return;
      }
      throw e;
    }
    const page = await browser.newPage({
      locale: 'zh-CN',
      viewport: { width: 1280, height: 840 },
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(gateway.launchUrl);
    await page.getByText('已连接', { exact: true }).waitFor();
    await page.getByLabel('消息', { exact: true }).fill('Read BTC prices');
    await page.getByRole('button', { name: '发送 ↑', exact: true }).click();
    await page
      .locator('.chat-answer')
      .getByText('Read-only chart data', { exact: true })
      .waitFor();
    assert.equal(
      await page.locator('.market-chart').count(),
      0,
      'read-only tools never navigate',
    );
    const session = (await runtime.listSessions())[0];
    await page
      .getByLabel('消息', { exact: true })
      .fill('Show NVDA then BTC weekly');
    await page.getByRole('button', { name: '发送 ↑', exact: true }).click();
    await page.getByRole('region', { name: '市场对话', exact: true }).waitFor();
    await page.getByLabel('BTC K 线图', { exact: true }).waitFor();
    await until(
      async () =>
        (await page
          .getByRole('button', { name: '1周', exact: true })
          .getAttribute('aria-pressed')) === 'true',
    );
    await page.getByText('BTC chart ready', { exact: true }).waitFor();
    assert.equal(
      (await runtime.listSessions()).length,
      1,
      'opening Markets reuses the current session',
    );
    assert.equal(
      (await runtime.sessionHistory(session.id))[0].marketContext,
      undefined,
    );
    assert.equal(
      (await runtime.sessionHistory(session.id)).find(
        (m) => m.toolCallId === 'nvda-view' && m.role === 'tool',
      ).marketAction.originViewId,
      undefined,
    );
    await page.getByTitle('展开到完整对话').click();
    await page
      .getByLabel('消息', { exact: true })
      .fill('Show NVDA after a delay');
    await page.getByRole('button', { name: '发送 ↑', exact: true }).click();
    await until(() => waiting);
    await page.getByRole('button', { name: '设置', exact: true }).click();
    wait.resolve();
    await until(() => runtime.runState(session.id).status === 'completed');
    await page.getByRole('heading', { name: '设置', exact: true }).waitFor();
    await page.getByRole('button', { name: '市场', exact: true }).click();
    await page.getByLabel('BTC K 线图', { exact: true }).waitFor();
    assert.equal(
      await page.getByLabel('NVDA K 线图', { exact: true }).count(),
      0,
      'a late Chat action cannot hijack navigation',
    );
    await page
      .getByLabel('消息', { exact: true })
      .fill('Show NVDA after another delay');
    await page.getByRole('button', { name: '发送 ↑', exact: true }).click();
    await until(() => tabWaiting);
    await page.getByRole('tab', { name: '资讯', exact: true }).click();
    tabWait.resolve();
    await page
      .locator('.chat-answer')
      .getByText('Tab-deferred chart ready', { exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole('tab', { name: '资讯', exact: true })
        .getAttribute('aria-selected'),
      'true',
      'a later user tab choice takes precedence',
    );
    assert.match(await page.locator('.market-heading h1').textContent(), /BTC/);
    await page
      .getByRole('button', { name: '查看 NVDA · 美股 · 1天 ↗', exact: true })
      .last()
      .click();
    await page.getByLabel('NVDA K 线图', { exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole('tab', { name: '图表', exact: true })
        .getAttribute('aria-selected'),
      'true',
      'deferred actions remain explicitly available',
    );
    assert.deepEqual(errors, []);
  } finally {
    wait.resolve();
    tabWait.resolve();
    await browser?.close();
  }
});

test('language preference translates all workspaces and Markets dialogs without resetting chat or chart state', async (t) => {
  const { runtime, service } = await marketsFixture(t);
  const btc = service.watchlist().find((i) => i.symbol === 'BTC');
  service.createAlert(
    {
      instrument: btc,
      metric: 'fundingHourlyPct',
      direction: 'below',
      threshold: -0.01,
      once: true,
    },
    'locale-alert',
  );
  const gateway = await startGateway({ runtime, markets: service, staticRoot });
  t.after(() => gateway.close());
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.SERIS_BROWSER_PATH
      ? { executablePath: process.env.SERIS_BROWSER_PATH }
      : { channel: 'chrome' }),
  });
  try {
    const page = await browser.newPage({
      locale: 'zh-CN',
      viewport: { width: 1440, height: 900 },
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(gateway.launchUrl);
    await page.getByText('已连接', { exact: true }).waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN');
    await page.getByRole('button', { name: '市场', exact: true }).click();
    await page.getByLabel('BTC K 线图').waitFor();
    await page.getByRole('button', { name: '1小时', exact: true }).click();
    await page.getByLabel('BTC K 线图').waitFor();
    const plot = await page.locator('.market-chart').boundingBox();
    await page.keyboard.down('Shift');
    await page.mouse.click(plot.x + plot.width * 0.35, plot.y + 80);
    await page.mouse.click(plot.x + plot.width * 0.6, plot.y + 80);
    await page.keyboard.up('Shift');
    await page.getByRole('button', { name: '清除区间', exact: true }).waitFor();
    await page
      .getByRole('button', { name: '打开市场对话', exact: true })
      .click();
    await page.getByRole('region', { name: '市场对话', exact: true }).waitFor();
    const send = async (label, text) => {
      await page.getByLabel(label, { exact: true }).fill(text);
      await page
        .getByRole('button', {
          name: label === '消息' ? '发送 ↑' : 'Send ↑',
          exact: true,
        })
        .click();
      await until(
        async () =>
          runtime.runState((await runtime.listSessions())[0]?.id)?.status ===
          'completed',
      );
      return (
        await runtime.sessionHistory((await runtime.listSessions())[0].id)
      )
        .filter((m) => m.role === 'user')
        .at(-1).marketContext;
    };
    const before = await send('消息', 'Before language change');
    assert.ok(before.selectedRange.to > before.selectedRange.from);
    await page
      .getByLabel('消息', { exact: true })
      .fill('Keep this draft / 保留草稿');
    await page
      .locator('.market-chart canvas')
      .first()
      .evaluate((el) => {
        window.localeTestCanvas = el;
      });
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page
      .getByRole('combobox', { name: '语言', exact: true })
      .selectOption('en');
    await page
      .getByRole('heading', { name: 'Settings', exact: true })
      .waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    assert.equal(
      await page.evaluate(() => localStorage.getItem('seris.language')),
      'en',
    );
    for (const label of ['Automation', 'Portfolio']) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.getByRole('heading', { name: label, exact: true }).waitFor();
      assert.match(
        await page.locator('main').innerText(),
        /This page is under development\./,
      );
      assert.doesNotMatch(
        await page.locator('main').innerText(),
        /[\p{Script=Han}]/u,
      );
    }
    // Strategies is a real workspace now — assert it has the catalog copy.
    await page.getByRole('button', { name: 'Strategies', exact: true }).click();
    await page.getByRole('heading', { name: 'Strategies', exact: true }).first().waitFor();
    assert.match(
      await page.locator('main').innerText(),
      /Ask Seris to|Tell Seris to|Pick a strategy/,
    );
    assert.doesNotMatch(
      await page.locator('main').innerText(),
      /[\p{Script=Han}]/u,
    );
    await page.getByRole('button', { name: 'Markets', exact: true }).click();
    await page.getByLabel('BTC candlestick chart').waitFor();
    assert.equal(
      await page
        .locator('.market-chart canvas')
        .first()
        .evaluate((el) => el === window.localeTestCanvas),
      true,
    );
    assert.equal(
      await page
        .getByRole('button', { name: '1h', exact: true })
        .getAttribute('aria-pressed'),
      'true',
    );
    await page
      .getByRole('button', { name: 'Clear range', exact: true })
      .waitFor();
    assert.equal(
      await page.getByLabel('Message', { exact: true }).inputValue(),
      'Keep this draft / 保留草稿',
    );
    assert.match(
      await page.locator('.composer-context').innerText(),
      /Selected range/,
    );
    const after = await send('Message', 'After language change');
    assert.equal(after.instrument.id, before.instrument.id);
    assert.equal(after.dataRef, before.dataRef);
    assert.deepEqual(after.selectedRange, before.selectedRange);
    assert.equal((await runtime.listSessions()).length, 1);
    await page
      .getByRole('button', { name: 'Search markets', exact: true })
      .click();
    await page
      .getByRole('dialog', { name: 'Search markets', exact: true })
      .waitFor();
    await page
      .getByRole('combobox', { name: 'Search markets', exact: true })
      .fill('NVDA');
    await page.getByText('1 result', { exact: true }).waitFor();
    await page
      .getByRole('button', { name: 'Unwatch NVDA · US stocks', exact: true })
      .waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: /^Alerts/ }).click();
    await page
      .getByText('BTC Funding ≤ -0.01 % / hour', { exact: true })
      .waitFor();
    await page
      .getByRole('button', { name: '＋ New alert', exact: true })
      .click();
    await page
      .getByRole('dialog', { name: 'Set BTC alert', exact: true })
      .waitFor();
    await page.getByLabel('Alert threshold').fill('70000');
    await page.getByRole('button', { name: 'Save alert', exact: true }).click();
    await page.getByText('BTC Price ≥ 70,000 USD', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page
      .getByRole('combobox', { name: 'Language', exact: true })
      .selectOption('zh-CN');
    for (const label of ['自动化', '持仓']) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.getByRole('heading', { name: label, exact: true }).waitFor();
      assert.match(await page.locator('main').innerText(), /此页面正在开发中/);
      assert.doesNotMatch(
        await page.locator('main').innerText(),
        /Automation|Portfolio|under development/,
      );
    }
    // 策略页是真页面了
    await page.getByRole('button', { name: '策略', exact: true }).click();
    await page.getByRole('heading', { name: '策略', exact: true }).first().waitFor();
    assert.match(
      await page.locator('main').innerText(),
      /告诉 Seris|还没有策略|从左侧选择一个策略/,
    );
    await page.getByRole('button', { name: '市场', exact: true }).click();
    await page
      .getByText('BTC 资金费率 ≤ -0.01 % / 小时', { exact: true })
      .waitFor();
    await page.getByText('BTC 价格 ≥ 70,000 USD', { exact: true }).waitFor();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page
      .getByRole('combobox', { name: '语言', exact: true })
      .selectOption('en');
    await until(
      async () =>
        (
          await page
            .getByRole('complementary', { name: 'App sidebar', exact: true })
            .boundingBox()
        ).width === 232,
    );
    await page.screenshot({ path: '/tmp/seris-settings-en.png' });
    await page.reload();
    await page.getByText('Connected', { exact: true }).waitFor();
    assert.equal(
      await page.locator('html').getAttribute('lang'),
      'en',
      'saved preference overrides browser Chinese locale',
    );
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    assert.equal(
      await page
        .getByRole('combobox', { name: 'Language', exact: true })
        .inputValue(),
      'en',
    );
    await page
      .getByRole('combobox', { name: 'Language', exact: true })
      .selectOption('zh-CN');
    await page.screenshot({ path: '/tmp/seris-settings-zh.png' });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('AI title updates the live sidebar without changing the conversation or its draft', async (t) => {
  const { runtime, deps } = await marketsFixture(t);
  let resolveTitle;
  const title = new Promise((resolve) => {
    resolveTitle = resolve;
  });
  deps.models.completeSimple = async () => title;
  const gateway = await startGateway({ runtime, staticRoot });
  t.after(() => gateway.close());
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.SERIS_BROWSER_PATH
      ? { executablePath: process.env.SERIS_BROWSER_PATH }
      : { channel: 'chrome' }),
  });
  try {
    const page = await browser.newPage({ locale: 'zh-CN' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(gateway.launchUrl);
    await page.getByText('已连接', { exact: true }).waitFor();
    await page.getByRole('button', { name: '＋ 新建', exact: true }).click();
    await page.locator('aside button').filter({ hasText: '新对话' }).waitFor();
    await page
      .getByLabel('消息', { exact: true })
      .fill('分析 BTC 的资金费率变化');
    await page.getByRole('button', { name: '发送 ↑', exact: true }).click();
    await page
      .getByRole('region', { name: '对话内容', exact: true })
      .getByText('Fixture analysis complete', { exact: true })
      .waitFor();
    const sessionId = (await runtime.listSessions())[0].id;
    await page.getByLabel('消息', { exact: true }).fill('下一条未发送的问题');
    resolveTitle(answer([{ type: 'text', text: 'BTC 资金费率分析' }]));
    await page
      .locator('aside button')
      .filter({ hasText: 'BTC 资金费率分析' })
      .waitFor();
    assert.equal(
      await page.getByLabel('消息', { exact: true }).inputValue(),
      '下一条未发送的问题',
    );
    assert.equal((await runtime.listSessions())[0].id, sessionId);
    assert.equal((await runtime.sessionHistory(sessionId)).length, 2);
    await page.reload();
    await page.getByText('已连接', { exact: true }).waitFor();
    await page
      .locator('aside button')
      .filter({ hasText: 'BTC 资金费率分析' })
      .waitFor();
    assert.deepEqual(errors, []);
  } finally {
    resolveTitle(answer([{ type: 'text', text: 'BTC 资金费率分析' }]));
    await browser.close();
  }
});
