/** list_artifacts — enumerate generated documents. */

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { defineTool, type HarnessTool } from '../registry.js';
import { ensureDir } from './store.js';

export const listArtifactsTool: HarnessTool = defineTool({
  name: 'list_artifacts',
  description: 'List every generated document in the artifacts dir with size and modified time. Files are downloadable at /api/artifacts/<filename>.',
  category: 'artifact',
  parameters: { type: 'object', properties: {} },
  async execute() {
    const dir = await ensureDir();
    try {
      const names = await readdir(dir);
      const entries = await Promise.all(
        names.map(async (n) => {
          const st = await stat(join(dir, n));
          return { filename: n, bytes: st.size, modifiedAt: st.mtime.toISOString(), downloadUrl: `/api/artifacts/${n}` };
        }),
      );
      entries.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
      return { real: true, dir, count: entries.length, artifacts: entries };
    } catch (e) {
      return { error: { kind: 'read', message: (e as Error).message } };
    }
  },
});

export const listTools: HarnessTool[] = [listArtifactsTool];
