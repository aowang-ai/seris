/** proactiveTools — ProactiveEngine (mandate → plan → approval → execute) as tools. */
import { defineTool, type HarnessTool } from './registry.js';
import { getProactiveEngine, type ProactiveStepKind } from '../proactive/engine.js';

export const proactiveCreateTool: HarnessTool = defineTool({
  name: 'proactive_create',
  description: 'Create a real proactive goal (an autonomous mandate the agent works toward). Dangerous steps gate on approval.',
  category: 'autopilot',
  parameters: { type: 'object', properties: {
    title: { type: 'string', description: 'Short goal, e.g. DCA ETH on dips.' },
    mandate: { type: 'string', description: 'Full mandate with budget/cadence/limits.' },
    tags: { type: 'array', items: { type: 'string' } },
    config: { type: 'object', description: 'budget, symbols, cadence, limits.' },
  }, required: ['title', 'mandate'] },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const goal = getProactiveEngine().create({ title: args.title, mandate: args.mandate, tags: args.tags ?? [], config: args.config ?? {} });
    return { real: true, created: true, goal };
  },
});

export const proactivePlanTool: HarnessTool = defineTool({
  name: 'proactive_plan',
  description: 'Lay out the step plan for a proactive goal. kinds: observe|compute|notify (safe) or trade.spot|trade.perp|wallet.transfer|connector.send (approval-gated).',
  category: 'autopilot',
  parameters: { type: 'object', properties: {
    goalId: { type: 'string', description: 'Goal id from proactive_create.' },
    steps: { type: 'array', description: 'Array of {kind, title, input?}.' },
  }, required: ['goalId', 'steps'] },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const steps = args.steps as Parameters<ReturnType<typeof getProactiveEngine>['plan']>[1];
    return { real: true, planned: true, goal: getProactiveEngine().plan(args.goalId, steps) };
  },
});

export const proactiveStatusTool: HarnessTool = defineTool({
  name: 'proactive_status',
  description: 'Get a proactive goals full state: plan steps with per-step status, approvals, history.',
  category: 'autopilot',
  parameters: { type: 'object', properties: { goalId: { type: 'string' } }, required: ['goalId'] },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const engine = getProactiveEngine();
    return { real: true, goal: engine.getGoal(args.goalId), approvals: engine.listApprovals({ goalId: args.goalId }) };
  },
});

export const proactivePauseTool: HarnessTool = defineTool({
  name: 'proactive_pause', description: 'Pause a proactive goal.', category: 'autopilot',
  parameters: { type: 'object', properties: { goalId: { type: 'string' } }, required: ['goalId'] },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any; return { real: true, goal: getProactiveEngine().pause(args.goalId) }; },
});

export const proactiveResumeTool: HarnessTool = defineTool({
  name: 'proactive_resume', description: 'Resume a paused proactive goal.', category: 'autopilot',
  parameters: { type: 'object', properties: { goalId: { type: 'string' } }, required: ['goalId'] },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any; return { real: true, goal: getProactiveEngine().resume(args.goalId) }; },
});

export const proactiveCloseTool: HarnessTool = defineTool({
  name: 'proactive_close', description: 'Close a proactive goal with an outcome and reason.', category: 'autopilot',
  parameters: { type: 'object', properties: { goalId: { type: 'string' }, outcome: { type: 'string' }, reason: { type: 'string' } }, required: ['goalId'] },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    return { real: true, goal: getProactiveEngine().close(args.goalId, args.outcome ?? 'completed', args.reason) };
  },
});

export const proactiveUpdateTool: HarnessTool = defineTool({
  name: 'proactive_update', description: 'Update a proactive goals title, mandate, tags, or config.', category: 'autopilot',
  parameters: { type: 'object', properties: { goalId: { type: 'string' }, title: { type: 'string' }, mandate: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, config: { type: 'object' } }, required: ['goalId'] },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const patch: Record<string, unknown> = {};
    if (args.title !== undefined) patch.title = args.title;
    if (args.mandate !== undefined) patch.mandate = args.mandate;
    if (args.tags !== undefined) patch.tags = args.tags;
    if (args.config !== undefined) patch.config = args.config;
    return { real: true, goal: getProactiveEngine().update(args.goalId, patch as never) };
  },
});

export const proactiveApprovalsTool: HarnessTool = defineTool({
  name: 'proactive_approvals', description: 'List pending approvals. Only the user interface may approve or reject them.', category: 'autopilot',
  parameters: { type: 'object', properties: { goalId: { type: 'string' } }, additionalProperties: false },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const engine = getProactiveEngine();
    if (args.decision) throw new Error('Approval decisions must come from the user interface');
    return { real: true, approvals: engine.listApprovals({ goalId: args.goalId }) };
  },
});

export const proactiveTools: HarnessTool[] = [
  proactiveCreateTool, proactivePlanTool, proactiveStatusTool,
  proactivePauseTool, proactiveResumeTool, proactiveCloseTool,
  proactiveUpdateTool, proactiveApprovalsTool,
];
