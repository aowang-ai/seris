/**
 * loop/types.ts — harness type surface, built on pi.
 *
 * The harness kernel is pi-agent-core; this module re-exports pi's types as
 * OUR canonical types so the rest of the codebase imports a single shape.
 * Seris tool extensions (ToolCategory and HarnessTool)
 * live on top.
 */

// pi's core types — these are our canonical shapes now.
export type {
  AgentMessage,
  AgentTool,
  AgentToolResult,
  AgentLoopConfig,
  AgentContext,
  AgentEvent,
  FinishTurn,
  PrepareRequest,
  BeforeToolCallContext,
  AfterToolCallContext,
  BeforeToolCallResult,
  AfterToolCallResult,
  AgentTurnContext,
  AgentTurnDecision,
} from '@earendil-works/pi-agent-core';

export type {
  Message,
  TextContent,
  ImageContent,
  Model,
  Tool,
  ToolCall,
  ToolResultMessage,
  Usage,
} from '@earendil-works/pi-ai';

/** Tool domain bucket — used by the registry for grouping + dynamic activation. */
export type ToolCategory =
  | 'market-data'
  | 'perps'
  | 'portfolio'
  | 'brokerage'
  | 'autopilot'
  | 'payments'
  | 'browser'
  | 'computer'
  | 'artifact'
  | 'memory'
  | 'connectors'
  | 'workspace'
  | 'skills'
  | 'strategies'
  | 'misc';

import type { AgentTool as PiAgentTool } from '@earendil-works/pi-agent-core';

/**
 * A harness tool = pi AgentTool + our category tag for registry grouping.
 * This is the shape every tool file under src/tools/ exports.
 */
export interface HarnessTool extends PiAgentTool<any> {
  category: ToolCategory;
}
