import { FewShotStore, getFewShotStore } from '../fewshot/harvest.js';
import { defaultMemoryStore } from './store.js';

/** Always-on learning integration. Keeps the existing retrieval/harvest policy. */
export class AgentMemory {
  prepareContext(query: string): string {
    const store = getFewShotStore();
    return store.renderForPrompt(store.retrieve(query, 3));
  }
  recordOutcome(query: string, tools: string[], answer: string): void {
    const verdict = FewShotStore.isWorthLearning(tools, answer);
    if (verdict.worth) getFewShotStore().harvest(query, tools, answer, verdict.reason);
  }
  close(): Promise<void> { return defaultMemoryStore.flush(); }
}
