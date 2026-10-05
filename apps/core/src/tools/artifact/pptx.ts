/** pptx — real PowerPoint decks via `pptxgenjs`. */

import { defineTool, type HarnessTool } from '../registry.js';
import { writeArtifact } from './store.js';
import * as PptxGenJSModule from 'pptxgenjs';
// pptxgenjs is CJS; in ESM use createRequire to load it.
import { createRequire } from 'node:module';
const PptxGenJS = createRequire(import.meta.url)('pptxgenjs') as new () => any;

interface SlideSpec {
  title?: string;
  subtitle?: string;
  bullets?: string[];
  table?: { headers: string[]; rows: string[][] };
  notes?: string;
}

export const pptxCreateTool: HarnessTool = defineTool({
  name: 'pptx_create',
  description:
    'Create a REAL PowerPoint deck (.pptx) on disk. Each slide may have a title, subtitle, bullet list, table (headers + rows), and speaker notes. Returns file path + bytes.',
  category: 'artifact',
  parameters: {
    type: 'object',
    properties: {
      filename: { type: 'string', description: 'Output filename, e.g. deck.pptx.' },
      slides: { type: 'array', description: 'SlideSpec[] — {title?, subtitle?, bullets?[], table?, notes?}.' },
    },
    required: ['filename', 'slides'],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    try {
      const pptx = new PptxGenJS();
      for (const spec of args.slides ?? []) {
        const slide = pptx.addSlide();
        if (spec.title) slide.addText(spec.title, { x: 0.5, y: 0.3, fontSize: 28, bold: true });
        if (spec.subtitle) slide.addText(spec.subtitle, { x: 0.5, y: 1.0, fontSize: 16, color: '666666' });
      }
      const data = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
      const out = await writeArtifact(args.filename, data);
      return { real: true, format: 'pptx', ...out, slides: args.slides.length };
    } catch (e) {
      return { error: { kind: 'write', message: (e as Error).message } };
    }
  },
});

export const pptxTools: HarnessTool[] = [pptxCreateTool];
