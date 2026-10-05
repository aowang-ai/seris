import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startGateway } from '../dist/gateway/server.js';
import { marketsFixture, until } from './markets-fixture.mjs';

test('market search aligns nine result rows with watch controls, truncates names and scrolls/selects correctly', async t => {
  const { runtime, service, provider } = await marketsFixture(t);
  const instruments = Array.from({ length: 9 }, (_, n) => ({
    id: `binance:HYPER${n}USDT`, symbol: `HYPER${n}`, providerSymbol: `HYPER${n}USDT`,
    name: n === 1 ? 'Hyper 中文标的名称较长时保持结果行清晰 '.repeat(8) : `Hyper ${n} / USDT`, kind: 'crypto', venue: 'binance',
  }));
  provider.search = async () => instruments;
  const gateway = await startGateway({ runtime, markets: service, staticRoot: fileURLToPath(new URL('../../desktop-ui/dist/', import.meta.url)) });
  t.after(() => gateway.close());
  const browser = await chromium.launch({ headless: true, ...(process.env.SERIS_BROWSER_PATH ? { executablePath: process.env.SERIS_BROWSER_PATH } : { channel: 'chrome' }) });
  t.after(() => browser.close());
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1280, height: 840 } });
  await page.goto(gateway.launchUrl);
  await page.getByText('已连接', { exact: true }).waitFor();
  await page.getByRole('button', { name: '市场', exact: true }).click();
  await page.getByLabel('BTC K 线图', { exact: true }).waitFor();
  await page.getByRole('button', { name: '搜索标的', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '搜索标的', exact: true });
  const input = dialog.getByRole('combobox', { name: '搜索标的', exact: true });
  await input.fill('Hyper');
  await dialog.getByText('9 个结果', { exact: true }).waitFor();
  for (const viewport of [{ width: 1280, height: 840 }, { width: 960, height: 640 }]) {
    await page.setViewportSize(viewport);
    const rows = await dialog.locator('.market-search-results').evaluate(el => {
      const stars = [...el.querySelectorAll('.market-search-stars button')];
      return [...el.querySelectorAll('[role="option"]')].map((row, n) => {
        const box = row.getBoundingClientRect(), star = stars[n].getBoundingClientRect();
        const name = row.querySelector('span'), label = row.querySelector('strong').getBoundingClientRect(), venue = row.querySelector('small').getBoundingClientRect();
        return { height: box.height, aligned: Math.abs(box.y - star.y) < 0.5 && Math.abs(box.height - star.height) < 0.5, contained: label.y >= box.y && venue.bottom <= box.bottom, truncated: name.scrollWidth > name.clientWidth };
      });
    });
    assert.equal(rows.length, 9);
    for (const row of rows) {
      assert.ok(row.height < 100 && row.height > 40, JSON.stringify(row));
      assert.equal(row.aligned, true, JSON.stringify(row));
      assert.equal(row.contained, true, JSON.stringify(row));
    }
    assert.equal(rows[1].truncated, true);
  }
  await input.dispatchEvent('compositionstart', { data: '中' });
  await input.press('Enter');
  assert.equal(await dialog.isVisible(), true, 'IME confirmation must not select a market');
  await input.dispatchEvent('compositionend', { data: '中文' });
  await input.dispatchEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: false });
  assert.equal(await dialog.isVisible(), true, 'WebKit IME confirmation must leave search open');
  for (let n = 0; n < 8; n++) await input.press('ArrowDown');
  await until(async () => await dialog.getByRole('option').last().getAttribute('aria-selected') === 'true');
  const visible = await dialog.locator('.market-search-results').evaluate(el => {
    const box = el.getBoundingClientRect(), last = el.querySelector('[role="option"]:last-child').getBoundingClientRect();
    return last.top >= box.top && last.bottom <= box.bottom && el.scrollTop > 0;
  });
  assert.equal(visible, true, 'keyboard selection scrolls the result and its watch button into view');
  const watch = dialog.getByRole('button', { name: '关注 HYPER8 · Binance · USDT 现货', exact: true });
  await watch.click();
  await dialog.getByRole('button', { name: '取消关注 HYPER8 · Binance · USDT 现货', exact: true }).waitFor();
  assert.ok(service.watchlist().some(i => i.id === instruments[8].id));
  assert.equal(await dialog.isVisible(), true, 'watching does not select the result or close search');
  await input.press('Enter');
  await dialog.waitFor({ state: 'hidden' });
  await page.getByLabel('HYPER8 K 线图', { exact: true }).waitFor();
});
