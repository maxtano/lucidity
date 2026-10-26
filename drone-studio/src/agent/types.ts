import type { Operation, Proposal } from '../core/commands';
import type { Project } from '../core/model';
import type { ValidationReport } from '../core/validation';
import type { ViewerBookmark, ViewerSnapshot } from '../core/viewer';
import type { AudienceTarget } from './audience-targets';

/** Display-only audience context captured once at the beginning of an agent run. */
export type AgentViewerContext = {
  current: { snapshot: ViewerSnapshot; aspect: number };
  savedViews: ViewerBookmark[];
};

export type AgentRequest = {
  project: Project;
  prompt: string;
  cueId: string;
  selection: number[];
  time: number;
  history?: { role: 'user' | 'assistant'; content: string }[];
  viewer?: AgentViewerContext;
  /** Exact unapplied commands to refine against this same saved revision. */
  previousDraft?: { projectId: string; revision: number; operations: unknown[] };
};

export type JSONSchema = Record<string, unknown>;
export type AgentToolDefinition = {
  type: 'function';
  name: string;
  description: string;
  strict: true;
  parameters: JSONSchema;
};
export type AgentUsage = { inputTokens: number; outputTokens: number };
export type AgentProvider = {
  complete(request: {
    input: unknown[];
    tools: AgentToolDefinition[];
    signal?: AbortSignal;
  }): Promise<{
    output: unknown[];
    calls: { id: string; name: string; arguments: string }[];
    text: string;
    usage?: AgentUsage;
  }>;
};

export type AgentEvent = {
  id: number;
  at: string;
  type: 'phase' | 'tool_start' | 'tool_result' | 'validation_error' | 'completed';
  message: string;
  tool?: string;
  callId?: string;
  details?: unknown;
};
export type AgentProposal = Proposal & { projectId: string };
export type AgentResult = {
  runId: string;
  status: 'completed' | 'cancelled' | 'failed';
  message: string;
  proposal?: AgentProposal;
  events: AgentEvent[];
  usage: AgentUsage;
  /** Owned run capture for validating optional navigation evidence; never a live viewer reference. */
  viewer?: AgentViewerContext;
  review?: ValidationReport;
  reviewLimited?: boolean;
};
export type AgentLimits = {
  maxTurns: number;
  maxToolCalls: number;
  maxOperations: number;
  maxArgumentChars: number;
  maxToolResultChars: number;
  maxResponseChars: number;
  maxContextChars: number;
  maxRuntimeMs: number;
};

/** Mutable only inside a run. A project edit is published exclusively as a proposal. */
export type AgentDraft = {
  base: Project;
  project: Project;
  /** Complete selection captured when the run began; unaffected by caller or draft changes. */
  selection: readonly number[];
  /** Owned run snapshot: inspecting audience views cannot alter the user's camera or bookmarks. */
  viewer?: AgentViewerContext;
  operations: Operation[];
  /** Run-local exact query sets. Replaced, never mutated, for shallow transaction rollback. */
  audienceTargets?: readonly AudienceTarget[];
  explanations: string[];
  reviewedOperationCount: number;
  review?: ValidationReport;
  reviewLimited: boolean;
  proposal?: AgentProposal;
};
