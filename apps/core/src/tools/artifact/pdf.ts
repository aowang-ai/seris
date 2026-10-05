/** pdf — real PDFs via `pdf-lib`. */

import { defineTool, type HarnessTool } from '../registry.js';
import { writeArtifact } from './store.js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

interface PdfPageSpec {
  heading?: string;
  paragraphs?: string[];
}

function wrapText(text: string, font: { widthOfTextAtSize(t: string, s: number): number }, size: number, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export const pdfCreateTool: HarnessTool = defineTool({
  name: 'pdf_create',
  description: 'Create a REAL multi-page PDF on disk. Provide a title and an array of page specs, each with an optional heading and paragraphs. Returns file path + bytes.',
  category: 'artifact',
  parameters: {
    type: 'object',
    properties: {
      filename: { type: 'string', description: 'Output filename, e.g. report.pdf.' },
      title: { type: 'string', description: 'Document title (first page header).' },
      pages: { type: 'array', description: 'PdfPageSpec[] — {heading?, paragraphs?[]}.' },
    },
    required: ['filename', 'pages'],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    try {
      const doc = await PDFDocument.create();
      const bold = await doc.embedFont(StandardFonts.HelveticaBold);
      const regular = await doc.embedFont(StandardFonts.Helvetica);
      const page = doc.addPage([612, 792]);
      let y = 750;
      if (args.title) {
        page.drawText(args.title, { x: 50, y, size: 22, font: bold, color: rgb(0.1, 0.1, 0.4) });
        y -= 40;
      }
      for (const spec of args.pages ?? []) {
        if (spec.heading) {
          page.drawText(spec.heading, { x: 50, y, size: 16, font: bold });
          y -= 26;
        }
        for (const para of spec.paragraphs ?? []) {
          for (const line of wrapText(para, regular, 11, 512)) {
            page.drawText(line, { x: 50, y, size: 11, font: regular });
            y -= 15;
          }
          y -= 6;
        }
        y -= 14;
      }
      const bytes = await doc.save();
      const out = await writeArtifact(args.filename, bytes);
      return { real: true, format: 'pdf', ...out, pages: args.pages.length };
    } catch (e) {
      return { error: { kind: 'write', message: (e as Error).message } };
    }
  },
});

export const pdfTools: HarnessTool[] = [pdfCreateTool];
