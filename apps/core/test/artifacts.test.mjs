import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { xlsxCreateTool, xlsxToCsvTool, xlsxAuditTool } from '../dist/tools/artifact/xlsx.js';
import { pptxCreateTool } from '../dist/tools/artifact/pptx.js';

test('document tools preserve spreadsheet values and produce a PowerPoint archive with patched dependencies', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'seris-documents-'));
  const previous = process.env.SERIS_ARTIFACTS_DIR;
  process.env.SERIS_ARTIFACTS_DIR = dir;
  t.after(async () => {
    if (previous === undefined) delete process.env.SERIS_ARTIFACTS_DIR;
    else process.env.SERIS_ARTIFACTS_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  });
  const workbook = (await xlsxCreateTool.execute('fixture', {
    filename: 'positions.xlsx',
    sheets: { Positions: [['标的', 'Quantity', 'Price'], ['BTC', 0.25, 82000], ['ETH', 2, 3200]] },
  })).details;
  assert.equal(workbook.real, true, JSON.stringify(workbook.error));
  const csv = (await xlsxToCsvTool.execute('fixture', { path: workbook.path })).details;
  assert.equal(csv.csv, '标的,Quantity,Price\nBTC,0.25,82000\nETH,2,3200');
  const inspected = (await xlsxAuditTool.execute('fixture', { path: workbook.path })).details;
  assert.deepEqual(inspected.sheets, [{ name: 'Positions', range: 'A1:C3', rows: 3, headers: ['标的', 'Quantity', 'Price'] }]);
  const slides = (await pptxCreateTool.execute('fixture', { filename: 'market.pptx', slides: [{ title: 'Seris', subtitle: '行情复盘' }] })).details;
  assert.equal(slides.real, true, JSON.stringify(slides.error));
  assert.equal((await readFile(slides.path)).subarray(0, 2).toString(), 'PK');
  assert.ok(slides.bytes > 1000);
});
