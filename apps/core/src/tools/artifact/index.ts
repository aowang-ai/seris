/** Artifact domain — real document factory (docx/xlsx/pptx/pdf). */

import type { HarnessTool } from '../registry.js';
import { docxTools } from './docx.js';
import { xlsxTools } from './xlsx.js';
import { pptxTools } from './pptx.js';
import { pdfTools } from './pdf.js';
import { listTools } from './list.js';

/** All artifact tools, ready for ToolRegistry.registerAll. */
export const allArtifactTools: HarnessTool[] = [
  ...docxTools,
  ...xlsxTools,
  ...pptxTools,
  ...pdfTools,
  ...listTools,
];
