/** docx — real Word documents via the `docx` package. */

import { defineTool, type HarnessTool } from '../registry.js';
import { writeArtifact } from './store.js';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';

interface DocxSection {
  heading?: string;
  level?: 1 | 2 | 3;
  paragraphs?: string[];
  bullets?: string[];
}

const HEADING = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3 } as const;

function renderSection(sec: DocxSection): Paragraph[] {
  const out: Paragraph[] = [];
  if (sec.heading) {
    out.push(new Paragraph({ heading: HEADING[sec.level ?? 2], children: [new TextRun({ text: sec.heading, bold: true })] }));
  }
  for (const p of sec.paragraphs ?? []) {
    out.push(new Paragraph({ children: [new TextRun(p)] }));
  }
  for (const b of sec.bullets ?? []) {
    out.push(new Paragraph({ children: [new TextRun('• ' + b)] }));
  }
  return out;
}

export const docxCreateTool: HarnessTool = defineTool({
  name: 'docx_create',
  description: 'Create a REAL Word document (.docx) on disk. Provide a title and an array of sections, each with an optional heading, paragraphs, and bullet list. Returns file path + bytes.',
  category: 'artifact',
  parameters: {
    type: 'object',
    properties: {
      filename: { type: 'string', description: 'Output filename, e.g. report.docx.' },
      title: { type: 'string', description: 'Document title.' },
      sections: { type: 'array', description: 'DocxSection[] — {heading?, level?, paragraphs?[], bullets?[]}.' },
    },
    required: ['filename', 'sections'],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    try {
      const children: Paragraph[] = [];
      if (args.title) {
        children.push(new Paragraph({ children: [new TextRun({ text: args.title, bold: true, size: 48 })] }));
      }
      for (const sec of args.sections ?? []) {
        children.push(...renderSection(sec));
      }
      const document = new Document({ sections: [{ children }] });
      const buf = await Packer.toBuffer(document);
      const out = await writeArtifact(args.filename, buf);
      return { real: true, format: 'docx', ...out, sections: (args.sections ?? []).length };
    } catch (e) {
      return { error: { kind: 'write', message: (e as Error).message } };
    }
  },
});

export const docxTools: HarnessTool[] = [docxCreateTool];
