/**
 * Persist goals, planned steps, approvals and progress. Side-effecting
 * step kinds require approval before an executor can advance them.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { dataPath } from "../runtime/paths.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Step "kind" — drives both the execute body and the approval gate. */
export type ProactiveStepKind =
  | "observe"        // read-only market / wallet / connector read
  | "compute"        // pure local computation (signal math, ranking)
  | "notify"         // surface a finding to the user (in-app message)
  | "trade.spot"     // DANGEROUS: spot buy/sell/swap (fund-moving)
  | "trade.perp"     // DANGEROUS: open/close/leverage a perp position
  | "wallet.transfer"// DANGEROUS: move funds between wallets
  | "connector.send" // DANGEROUS: external side-effect (mail/message/post)
  | "custom";

/** Approval-gated kinds. Anything in this set suspends until approved. */
export const DANGEROUS_KINDS: ReadonlySet<ProactiveStepKind> = new Set([
  "trade.spot",
  "trade.perp",
  "wallet.transfer",
  "connector.send",
]);

export type ProactiveStepStatus =
  | "pending"            // not yet attempted
  | "awaiting_approval"  // gated; blocked on human/sign-off
  | "running"            // execute() in flight
  | "done"               // completed successfully
  | "failed"             // execute() threw, or was rejected
  | "skipped";           // deliberately passed over (e.g. step.update)

export interface ProactiveStep {
  id: string;
  /** 1-based order in the plan. Duplicates are forbidden. */
  index: number;
  kind: ProactiveStepKind;
  /** One-line human summary surfaced to the user. */
  title: string;
  /** Free-form inputs the step's execute() reads. */
  input: Record<string, unknown>;
  status: ProactiveStepStatus;
  /** Populated when status === 'awaiting_approval' | 'done' | 'failed'. */
  approvalId?: string;
  result?: unknown;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
}

export type ProactiveStatus =
  | "draft"
  | "active"
  | "paused"
  | "closed.completed"
  | "closed.cancelled"
  | "closed.failed";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface ProactiveApproval {
  id: string;
  goalId: string;
  stepId: string;
  /** Why this step is gated (surfaced to the approver). */
  reason: string;
  /** Snapshot of the step's dangerous payload the approver signs off on. */
  payload: Record<string, unknown>;
  status: ApprovalStatus;
  createdAt: number;
  decidedAt?: number;
  decidedBy?: string; // "user" | "policy:<name>" — free-form audit tag
  note?: string;
}

export interface ProactiveGoal {
  id: string;
  /** Short goal statement, e.g. "DCA $500 into ETH whenever it dips 5%". */
  title: string;
  /** Longer natural-language mandate the planner works from. */
  mandate: string;
  /** Optional tags for filtering (e.g. ["dca","eth","low-risk"]). */
  tags: string[];
  status: ProactiveStatus;
  /** Owner-provided runtime config (budget, watch symbols, cadence...). */
  config: Record<string, unknown>;
  plan: ProactiveStep[];
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
  /** Free-form closure reason populated by proactive_close. */
  closeReason?: string;
}

interface ProactiveStore {
  goals: Record<string, ProactiveGoal>;
  approvals: Record<string, ProactiveApproval>;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export interface ProactiveEngineOptions {
  /** Absolute path to the state file. Defaults to <cwd>/.data/proactive.json. */
  statePath?: string;
  /**
   * Step executor hooks. The engine ships no real side-effecting code —
   * the caller wires these to actual tools (perps, wallet, browser, etc.)
   * when a step leaves `awaiting_approval`. Returning any value marks the
   * step `done`; throwing marks it `failed`.
   *
   * The default executor is a no-op observer: it just echoes the step's
   * input. That makes the whole engine safe to drive in tests and from
   * offline demos.
   */
  executeStep?: (
    goal: ProactiveGoal,
    step: ProactiveStep,
  ) => Promise<unknown> | unknown;
}

let seq = 0;
const nextId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${(++seq).toString(36)}`;

const now = (): number => Date.now();

export class ProactiveEngine {
  private store: ProactiveStore = { goals: {}, approvals: {} };
  private readonly statePath: string;
  private readonly executeStep: NonNullable<ProactiveEngineOptions["executeStep"]>;

  constructor(opts: ProactiveEngineOptions = {}) {
    this.statePath = resolve(
      opts.statePath ?? dataPath("proactive.json"),
    );
    this.executeStep =
      opts.executeStep ?? ((g, s) => ({ echoed: true, goalId: g.id, step: s.input }));
    this.load();
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  private load(): void {
    try {
      const raw = readFileSync(this.statePath, "utf8");
      const parsed = JSON.parse(raw) as ProactiveStore;
      if (parsed && typeof parsed === "object") {
        this.store = {
          goals: parsed.goals ?? {},
          approvals: parsed.approvals ?? {},
        };
      }
    } catch {
      // Missing/corrupt file: start empty. Engine is safe-by-default.
      this.store = { goals: {}, approvals: {} };
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.statePath), { recursive: true });
      const tmp = `${this.statePath}.tmp-${process.pid}`;
      writeFileSync(tmp, JSON.stringify(this.store, null, 2), "utf8");
      renameSync(tmp, this.statePath);
    } catch {
      throw new Error("Unable to persist proactive state");
    }
  }

  // -------------------------------------------------------------------------
  // Lookups (defensive copies — callers can't mutate internal state)
  // -------------------------------------------------------------------------

  private getGoalOrThrow(goalId: string): ProactiveGoal {
    const g = this.store.goals[goalId];
    if (!g) throw new Error(`proactive: unknown goal "${goalId}"`);
    return g;
  }

  listGoals(): ProactiveGoal[] {
    return Object.values(this.store.goals)
      .map((g) => ({ ...g, plan: g.plan.map((s) => ({ ...s })) }))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  getGoal(goalId: string): ProactiveGoal {
    const g = this.getGoalOrThrow(goalId);
    return { ...g, plan: g.plan.map((s) => ({ ...s })) };
  }

  listApprovals(filter: { goalId?: string; status?: ApprovalStatus } = {}): ProactiveApproval[] {
    return Object.values(this.store.approvals)
      .filter((a) => (filter.goalId ? a.goalId === filter.goalId : true))
      .filter((a) => (filter.status ? a.status === filter.status : true))
      .map((a) => ({ ...a }))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  // -------------------------------------------------------------------------
  // Lifecycle: create / plan / status / pause / resume / close / update
  // -------------------------------------------------------------------------

  create(input: {
    title: string;
    mandate: string;
    tags?: string[];
    config?: Record<string, unknown>;
    /** Optional pre-built plan; otherwise `proactive_plan` derives one. */
    plan?: Array<Pick<ProactiveStep, "kind" | "title"> & Partial<ProactiveStep>>;
  }): ProactiveGoal {
    const id = nextId("pg");
    const ts = now();
    const plan: ProactiveStep[] = (input.plan ?? []).map((p, i) => ({
      id: p.id ?? nextId("ps"),
      index: p.index ?? i + 1,
      kind: p.kind,
      title: p.title,
      input: p.input ?? {},
      status: p.status ?? "pending",
    }));
    const goal: ProactiveGoal = {
      id,
      title: input.title,
      mandate: input.mandate,
      tags: input.tags ?? [],
      status: plan.length > 0 ? "active" : "draft",
      config: input.config ?? {},
      plan,
      createdAt: ts,
      updatedAt: ts,
    };
    this.store.goals[id] = goal;
    this.persist();
    return this.getGoal(id);
  }

  /**
   * Replace the plan of an existing goal. Idempotent when called with the
   * same step list. Refuses once the goal is closed.
   *
   * The caller supplies the plan; this engine persists and advances it.
   */
  plan(goalId: string, steps: Array<Pick<ProactiveStep, "kind" | "title"> & Partial<ProactiveStep>>): ProactiveGoal {
    const goal = this.getGoalOrThrow(goalId);
    if (goal.status.startsWith("closed.")) {
      throw new Error(`proactive: cannot re-plan a closed goal (${goal.status})`);
    }
    const seen = new Set<number>();
    const plan: ProactiveStep[] = steps.map((p, i) => {
      const idx = p.index ?? i + 1;
      if (seen.has(idx)) throw new Error(`proactive: duplicate step index ${idx}`);
      seen.add(idx);
      return {
        id: p.id ?? nextId("ps"),
        index: idx,
        kind: p.kind,
        title: p.title,
        input: p.input ?? {},
        status: "pending",
      };
    });
    plan.sort((a, b) => a.index - b.index);
    for (const approval of Object.values(this.store.approvals)) {
      if (approval.goalId === goalId && approval.status === 'pending') {
        approval.status = 'rejected'; approval.decidedAt = now(); approval.note = 'Plan replaced';
      }
    }
    goal.plan = plan;
    goal.status = "active";
    goal.updatedAt = now();
    this.persist();
    return this.getGoal(goalId);
  }

  pause(goalId: string): ProactiveGoal {
    const goal = this.getGoalOrThrow(goalId);
    if (goal.status === "paused") return this.getGoal(goalId); // idempotent
    if (goal.status.startsWith("closed.")) {
      throw new Error(`proactive: cannot pause a closed goal (${goal.status})`);
    }
    goal.status = "paused";
    goal.updatedAt = now();
    this.persist();
    return this.getGoal(goalId);
  }

  resume(goalId: string): ProactiveGoal {
    const goal = this.getGoalOrThrow(goalId);
    if (goal.status !== "paused") {
      throw new Error(`proactive: cannot resume from status "${goal.status}"`);
    }
    goal.status = "active";
    goal.updatedAt = now();
    this.persist();
    return this.getGoal(goalId);
  }

  close(goalId: string, outcome: "completed" | "cancelled" | "failed", reason?: string): ProactiveGoal {
    const goal = this.getGoalOrThrow(goalId);
    if (goal.status.startsWith("closed.")) {
      return this.getGoal(goalId); // idempotent — already closed
    }
    goal.status = `closed.${outcome}` as ProactiveStatus;
    goal.closedAt = now();
    goal.updatedAt = goal.closedAt;
    goal.closeReason = reason;
    // Cancel any pending approvals tied to this goal.
    for (const ap of Object.values(this.store.approvals)) {
      if (ap.goalId === goalId && ap.status === "pending") {
        ap.status = "rejected";
        ap.decidedAt = now();
        ap.note = "auto-rejected: goal closed";
      }
    }
    this.persist();
    return this.getGoal(goalId);
  }

  update(goalId: string, patch: Partial<Pick<ProactiveGoal, "title" | "mandate" | "tags" | "config">>): ProactiveGoal {
    const goal = this.getGoalOrThrow(goalId);
    if (goal.status.startsWith("closed.")) {
      throw new Error(`proactive: cannot update a closed goal (${goal.status})`);
    }
    if (patch.title !== undefined) goal.title = patch.title;
    if (patch.mandate !== undefined) goal.mandate = patch.mandate;
    if (patch.tags !== undefined) goal.tags = [...patch.tags];
    if (patch.config !== undefined) goal.config = { ...goal.config, ...patch.config };
    goal.updatedAt = now();
    this.persist();
    return this.getGoal(goalId);
  }

  // -------------------------------------------------------------------------
  // Act: work the next pending step, honouring the approval gate
  // -------------------------------------------------------------------------

  /**
   * Attempt to advance the goal by one step.
   *
   * Returns a structured result so the tool layer can decide what to surface
   * to the model:
   *   - { kind: 'no-step' }        plan exhausted or nothing to do
   *   - { kind: 'blocked', approval }   step is gated; approval created
   *   - { kind: 'awaiting', approval }  gated step, approval already pending
   *   - { kind: 'done', step }     step executed successfully
   *   - { kind: 'failed', step, error } step threw
   */
  async act(goalId: string): Promise<
    | { kind: "no-step"; goal: ProactiveGoal }
    | { kind: "blocked"; goal: ProactiveGoal; step: ProactiveStep; approval: ProactiveApproval }
    | { kind: "awaiting"; goal: ProactiveGoal; step: ProactiveStep; approval: ProactiveApproval }
    | { kind: "done"; goal: ProactiveGoal; step: ProactiveStep }
    | { kind: "failed"; goal: ProactiveGoal; step: ProactiveStep; error: string }
  > {
    const goal = this.getGoalOrThrow(goalId);
    if (goal.status === "paused") {
      throw new Error(`proactive: goal ${goalId} is paused`);
    }
    if (goal.status.startsWith("closed.")) {
      throw new Error(`proactive: goal ${goalId} is closed (${goal.status})`);
    }
    if (goal.status === "draft") {
      throw new Error(`proactive: goal ${goalId} has no plan yet — call proactive_plan first`);
    }

    // 1) If a step is already awaiting approval, surface it (do NOT advance).
    const awaiting = goal.plan.find((s) => s.status === "awaiting_approval");
    if (awaiting) {
      const approval = awaiting.approvalId
        ? this.store.approvals[awaiting.approvalId]
        : undefined;
      if (approval) {
        return {
          kind: "awaiting",
          goal: this.getGoal(goalId),
          step: { ...awaiting },
          approval: { ...approval },
        };
      }
      // Corrupt state — fail safe by resetting to pending.
      awaiting.status = "pending";
      awaiting.approvalId = undefined;
    }

    // 2) Pick the next pending step.
    const step = goal.plan.find((s) => s.status === "pending");
    if (!step) {
      // Plan exhausted; if everything else is done/skipped, auto-close.
      const anyFailed = goal.plan.some((s) => s.status === "failed");
      if (!anyFailed) {
        this.close(goalId, "completed", "plan exhausted");
      }
      return { kind: "no-step", goal: this.getGoal(goalId) };
    }

    // 3) Approval gate for dangerous kinds.
    if (DANGEROUS_KINDS.has(step.kind)) {
      const approval: ProactiveApproval = {
        id: nextId("pa"),
        goalId,
        stepId: step.id,
        reason: `step kind "${step.kind}" requires approval (${step.title})`,
        payload: { kind: step.kind, title: step.title, input: step.input },
        status: "pending",
        createdAt: now(),
      };
      this.store.approvals[approval.id] = approval;
      step.status = "awaiting_approval";
      step.approvalId = approval.id;
      goal.updatedAt = now();
      this.persist();
      return {
        kind: "blocked",
        goal: this.getGoal(goalId),
        step: { ...step },
        approval: { ...approval },
      };
    }

    // 4) Safe kinds execute in-line.
    step.status = "running";
    step.startedAt = now();
    goal.updatedAt = step.startedAt;
    this.persist();
    try {
      const result = await this.executeStep(goal, step);
      step.status = "done";
      step.result = result;
      step.finishedAt = now();
      goal.updatedAt = step.finishedAt;
      this.persist();
      return { kind: "done", goal: this.getGoal(goalId), step: { ...step } };
    } catch (err) {
      step.status = "failed";
      step.error = err instanceof Error ? err.message : String(err);
      step.finishedAt = now();
      goal.updatedAt = step.finishedAt;
      this.persist();
      return {
        kind: "failed",
        goal: this.getGoal(goalId),
        step: { ...step },
        error: step.error,
      };
    }
  }

  // -------------------------------------------------------------------------
  // Approvals
  // -------------------------------------------------------------------------

  /**
   * Approve a pending approval, then immediately run the gated step.
   * Returns the post-decision goal. Refuses when the approval is not pending.
   */
  async approve(approvalId: string, opts: { decidedBy?: string; note?: string } = {}): Promise<{
    approval: ProactiveApproval;
    stepResult:
      | { kind: "done"; step: ProactiveStep }
      | { kind: "failed"; step: ProactiveStep; error: string };
    goal: ProactiveGoal;
  }> {
    const ap = this.store.approvals[approvalId];
    if (!ap) throw new Error(`proactive: unknown approval "${approvalId}"`);
    if (ap.status !== "pending") {
      throw new Error(`proactive: approval ${approvalId} is already ${ap.status}`);
    }
    const goal = this.getGoalOrThrow(ap.goalId);
    const step = goal.plan.find((s) => s.id === ap.stepId);
    if (!step || goal.status !== 'active' || step.status !== 'awaiting_approval' || step.approvalId !== approvalId
      || JSON.stringify(ap.payload) !== JSON.stringify({kind:step.kind,title:step.title,input:step.input})) {
      throw new Error('Approval no longer matches the active plan');
    }

    ap.status = "approved";
    ap.decidedAt = now();
    ap.decidedBy = opts.decidedBy ?? "user";
    ap.note = opts.note;

    step.status = "running";
    step.startedAt = now();
    goal.updatedAt = step.startedAt;
    this.persist();

    try {
      const result = await this.executeStep(goal, step);
      step.status = "done";
      step.result = result;
      step.finishedAt = now();
      goal.updatedAt = step.finishedAt;
      this.persist();
      return {
        approval: { ...ap },
        stepResult: { kind: "done", step: { ...step } },
        goal: this.getGoal(goal.id),
      };
    } catch (err) {
      step.status = "failed";
      step.error = err instanceof Error ? err.message : String(err);
      step.finishedAt = now();
      // A failed dangerous step also fails the goal — dangerous actions
      // shouldn't silently continue into the next step of the plan.
      this.store.approvals[approvalId] = ap;
      this.close(goal.id, "failed", `step "${step.title}" threw: ${step.error}`);
      return {
        approval: { ...ap },
        stepResult: { kind: "failed", step: { ...step }, error: step.error },
        goal: this.getGoal(goal.id),
      };
    }
  }

  /** Reject a pending approval: fails the step AND fails the goal. */
  reject(approvalId: string, opts: { decidedBy?: string; note?: string } = {}): {
    approval: ProactiveApproval;
    goal: ProactiveGoal;
  } {
    const ap = this.store.approvals[approvalId];
    if (!ap) throw new Error(`proactive: unknown approval "${approvalId}"`);
    if (ap.status !== "pending") {
      throw new Error(`proactive: approval ${approvalId} is already ${ap.status}`);
    }
    const goal = this.getGoalOrThrow(ap.goalId);
    const step = goal.plan.find((s) => s.id === ap.stepId);
    ap.status = "rejected";
    ap.decidedAt = now();
    ap.decidedBy = opts.decidedBy ?? "user";
    ap.note = opts.note;
    if (step) {
      step.status = "failed";
      step.error = `rejected: ${opts.note ?? "no reason given"}`;
      step.finishedAt = now();
    }
    this.store.approvals[approvalId] = ap;
    this.close(goal.id, "failed", `approval ${approvalId} rejected`);
    return { approval: { ...ap }, goal: this.getGoal(goal.id) };
  }
}

// ---------------------------------------------------------------------------
// Singleton — the tools/ layer shares one engine per process.
// ---------------------------------------------------------------------------

let shared: ProactiveEngine | null = null;
let sharedPath = '';

export function getProactiveEngine(): ProactiveEngine {
  const path = dataPath('proactive.json');
  if (!shared || sharedPath !== path) { shared = new ProactiveEngine({statePath:path}); sharedPath = path; }
  return shared;
}

/** Test hook: reset the singleton (e.g. between vitest runs). */
export function resetProactiveEngineForTests(engine?: ProactiveEngine): void {
  shared = engine ?? null; sharedPath = dataPath('proactive.json');
}
