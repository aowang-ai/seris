/** xlsx — real Excel workbooks via the `xlsx` (SheetJS) package. */

import { readFile } from 'node:fs/promises';
import { defineTool, type HarnessTool } from '../registry.js';
import { writeArtifact } from './store.js';
import * as XLSX from 'xlsx';

export const xlsxCreateTool: HarnessTool = defineTool({
  name: 'xlsx_create',
  description:
    'Create a REAL Excel workbook (.xlsx) on disk. Sheets maps sheet name → array of row arrays (first row usually headers). Returns file path + bytes.',
  category: 'artifact',
  parameters: {
    type: 'object',
    properties: {
      filename: { type: 'string', description: 'Output filename, e.g. report.xlsx.' },
      sheets: { type: 'object', description: '{ "Sheet1": [[header,...],[row,...]] }.' },
      columnWidths: { type: 'object', description: 'Optional { sheetName: [width,...] } in chars.' },
    },
    required: ['filename', 'sheets'],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    try {
      const wb = XLSX.utils.book_new();
      for (const [name, rows] of Object.entries(args.sheets) as Array<[string, unknown[][]]>) {
        const ws = XLSX.utils.aoa_to_sheet(rows);
        const widths = args.columnWidths?.[name];
        if (widths) ws['!cols'] = widths.map((wch: number) => ({ wch }));
        XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31) || 'Sheet1');
      }
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
      const out = await writeArtifact(args.filename, buf);
      return { real: true, format: 'xlsx', ...out, sheets: Object.keys(args.sheets) };
    } catch (e) {
      return { error: { kind: 'write', message: (e as Error).message } };
    }
  },
});


export const xlsxToCsvTool: HarnessTool = defineTool({
  name: 'xlsx_to_csv',
  description: 'Convert an existing .xlsx file to CSV text of a given sheet (returns inline).',
  category: 'artifact',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path to the .xlsx file.' },
      sheet: { type: 'string', description: 'Sheet name (default: first).' },
    },
    required: ['path'],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    try {
      const buf = await readFile(args.path);
      const wb = XLSX.read(buf, { type: 'buffer' });
      const name = args.sheet ?? wb.SheetNames[0];
      const ws = wb.Sheets[name];
      if (!ws) return { error: { kind: 'not_found', message: 'No sheet ' + name } };
      return { real: true, sheet: name, csv: XLSX.utils.sheet_to_csv(ws) };
    } catch (e) {
      return { error: { kind: 'read', message: (e as Error).message } };
    }
  },
});


export const xlsxAuditTool: HarnessTool = defineTool({
  name: 'xlsx_audit',
  description: 'Inspect an existing .xlsx file: sheet names, row/col counts, header cells per sheet.',
  category: 'artifact',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string', description: 'Absolute path to the .xlsx file.' } },
    required: ['path'],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    try {
      const buf = await readFile(args.path);
      const wb = XLSX.read(buf, { type: 'buffer' });
      return {
        real: true,
        path: args.path,
        sheets: wb.SheetNames.map((name) => {
          const ws = wb.Sheets[name];
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false }) as unknown[][];
          return { name, range: ws['!ref'] ?? 'A1', rows: rows.length, headers: (rows[0] ?? []).slice(0, 12) };
        }),
      };
    } catch (e) {
      return { error: { kind: 'read', message: (e as Error).message } };
    }
  },
});

export const xlsxTools: HarnessTool[] = [xlsxCreateTool, xlsxToCsvTool, xlsxAuditTool];
