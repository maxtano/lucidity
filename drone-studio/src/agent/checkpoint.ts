import { z } from 'zod';
import { operationSchema, type Operation } from '../core/commands';
import { projectSchema, type Project } from '../core/model';
import { defaultAgentLimits } from './harness';
import { executeAgentTool, stageOperations } from './tools';
import type { AgentDraft, AgentEvent, AgentProposal, AgentResult } from './types';

export const MAX_CHECKPOINT_BYTES = 32_000_000;

const proposalContentSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(4000),
    changes: z.array(z.string().trim().min(1).max(500)).min(1).max(24),
    operations: z.array(operationSchema).min(1).max(defaultAgentLimits.maxOperations),
  })
  .strict();
const checkpointSchema = z
  .object({
    format: z.literal('lucidity.agent-draft'),
    version: z.literal(1),
    createdAt: z.string().datetime({ offset: true }),
    base: z
      .object({
        projectId: z.string().min(1).max(100),
        revision: z.number().int().nonnegative(),
        fingerprint: z
          .string()
          .regex(/^[0-9a-f]{64}$/, 'Expected a lowercase SHA-256 fingerprint.'),
      })
      .strict(),
    proposal: proposalContentSchema,
  })
  .strict();
const proposalInputSchema = proposalContentSchema
  .extend({
    projectId: z.string().min(1).max(100),
    revision: z.number().int().nonnegative(),
  })
  .strict();

export type ProposalCheckpoint = {
  format: 'lucidity.agent-draft';
  version: 1;
  createdAt: string;
  base: { projectId: string; revision: number; fingerprint: string };
  proposal: { title: string; description: string; changes: string[]; operations: Operation[] };
};

/** Count UTF-8 bytes without allocating an unbounded temporary encoded buffer. */
function byteLength(text: string): number {
  let length = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code <= 0x7f) length++;
    else if (code <= 0x7ff) length += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < text.length &&
      text.charCodeAt(index + 1) >= 0xdc00 &&
      text.charCodeAt(index + 1) <= 0xdfff
    ) {
      length += 4;
      index++;
    } else length += 3;
    if (length > MAX_CHECKPOINT_BYTES) return length;
  }
  return length;
}
function assertTextSize(text: string, label: string) {
  if (text.length > MAX_CHECKPOINT_BYTES || byteLength(text) > MAX_CHECKPOINT_BYTES)
    throw new Error(`${label} exceeds the 32 MB UTF-8 size limit.`);
}

/** Linear serialization apart from sorting each object's keys. Array order is authoritative. */
function canonicalJSON(value: unknown, label: string): string {
  const chunks: string[] = [];
  const ancestors = new Set<object>();
  let size = 0;
  const append = (text: string) => {
    if (text.length > MAX_CHECKPOINT_BYTES || (size += byteLength(text)) > MAX_CHECKPOINT_BYTES)
      throw new Error(`${label} exceeds the 32 MB UTF-8 size limit.`);
    chunks.push(text);
  };
  const visit = (item: unknown, depth: number) => {
    if (depth > 128) throw new Error(`${label} exceeds the supported JSON nesting depth.`);
    if (item === null) {
      append('null');
      return;
    }
    if (typeof item === 'string' || typeof item === 'boolean') {
      append(JSON.stringify(item));
      return;
    }
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new Error(`${label} contains a non-finite JSON number.`);
      append(JSON.stringify(item));
      return;
    }
    if (!item || typeof item !== 'object') throw new Error(`${label} contains a non-JSON value.`);
    if (ancestors.has(item)) throw new Error(`${label} contains a circular reference.`);
    ancestors.add(item);
    if (Array.isArray(item)) {
      append('[');
      for (let index = 0; index < item.length; index++) {
        if (index) append(',');
        visit(item[index], depth + 1);
      }
      append(']');
    } else {
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null)
        throw new Error(`${label} contains a non-JSON object.`);
      append('{');
      let count = 0;
      for (const key of Object.keys(item).sort()) {
        const child = (item as Record<string, unknown>)[key];
        // Optional absent properties have the same portable JSON representation as undefined.
        if (child === undefined) continue;
        if (count++) append(',');
        append(JSON.stringify(key));
        append(':');
        visit(child, depth + 1);
      }
      append('}');
    }
    ancestors.delete(item);
  };
  visit(value, 0);
  return chunks.join('');
}

/** Shared schemas intentionally strip some unknown fields; portable imports must reject them. */
function rejectDroppedFields(input: unknown, parsed: unknown, path: string): void {
  if (!input || !parsed || typeof input !== 'object' || typeof parsed !== 'object') return;
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(parsed, key)) throw new Error(`Unknown field in ${path}.${key}.`);
    rejectDroppedFields(value, (parsed as Record<string, unknown>)[key], `${path}.${key}`);
  }
}
function parseStrict<T>(schema: z.ZodType<T>, input: unknown, label: string): T {
  try {
    const parsed = schema.parse(input);
    rejectDroppedFields(input, parsed, label);
    return parsed;
  } catch (error) {
    if (error instanceof z.ZodError)
      throw new Error(
        `Invalid ${label}: ${error.issues
          .slice(0, 4)
          .map((issue) => `${issue.path.join('.') || label}: ${issue.message}`)
          .join('; ')}`
      );
    throw error;
  }
}
function snapshot(base: Project) {
  const canonical = canonicalJSON(base, 'Base project');
  const project = structuredClone(parseStrict(projectSchema, base, 'base project'));
  return { canonical, project };
}
function validateCheckpoint(checkpoint: ProposalCheckpoint): ProposalCheckpoint {
  canonicalJSON(checkpoint, 'Checkpoint');
  return structuredClone(parseStrict(checkpointSchema, checkpoint, 'checkpoint'));
}
function stateFor(base: Project): AgentDraft {
  return {
    base,
    project: base,
    selection: Object.freeze([]),
    operations: [],
    explanations: [],
    reviewedOperationCount: -1,
    reviewLimited: false,
  };
}
async function fingerprint(canonical: string): Promise<string> {
  if (!globalThis.crypto?.subtle)
    throw new Error('Secure SHA-256 hashing is unavailable in this environment.');
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical)
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function assertIdentity(base: Project, identity: { projectId: string; revision: number }) {
  if (base.id !== identity.projectId)
    throw new Error(
      'This checkpoint belongs to a different project. Open its original base project before restoring.'
    );
  if (base.revision !== identity.revision)
    throw new Error(
      'This checkpoint is stale: its saved base revision differs from the current project.'
    );
}

/** Export only replayable proposal content and a fingerprint; no runtime context or review is stored. */
export async function createProposalCheckpoint(
  base: Project,
  proposal: AgentProposal
): Promise<ProposalCheckpoint> {
  const baseSnapshot = snapshot(base);
  canonicalJSON(proposal, 'Proposal');
  const parsed = structuredClone(parseStrict(proposalInputSchema, proposal, 'proposal'));
  assertIdentity(baseSnapshot.project, parsed);
  const state = stateFor(baseSnapshot.project);
  stageOperations(
    parsed.operations,
    'Validate a portable draft checkpoint.',
    state,
    defaultAgentLimits
  );
  canonicalJSON(state.project, 'Draft project');
  const checkpoint: ProposalCheckpoint = {
    format: 'lucidity.agent-draft',
    version: 1,
    createdAt: new Date().toISOString(),
    base: {
      projectId: baseSnapshot.project.id,
      revision: baseSnapshot.project.revision,
      fingerprint: await fingerprint(baseSnapshot.canonical),
    },
    proposal: {
      title: parsed.title,
      description: parsed.description,
      changes: parsed.changes,
      operations: state.operations,
    },
  };
  canonicalJSON(checkpoint, 'Checkpoint');
  return checkpoint;
}

export function serializeProposalCheckpoint(checkpoint: ProposalCheckpoint): string {
  return canonicalJSON(validateCheckpoint(checkpoint), 'Checkpoint');
}

export function parseProposalCheckpoint(text: string): ProposalCheckpoint {
  if (typeof text !== 'string') throw new Error('Checkpoint input must be JSON text.');
  assertTextSize(text, 'Checkpoint');
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new Error('Checkpoint is not valid JSON.');
  }
  return validateCheckpoint(input as ProposalCheckpoint);
}

/** Restore identical authored content at its current revision, then replay and freshly review it. */
export async function restoreProposalCheckpoint(
  base: Project,
  checkpoint: ProposalCheckpoint
): Promise<AgentResult> {
  const baseSnapshot = snapshot(base);
  const saved = validateCheckpoint(checkpoint);
  if (baseSnapshot.project.id !== saved.base.projectId)
    throw new Error(
      'This checkpoint belongs to a different project. Open its original base project before restoring.'
    );
  const currentRevision = baseSnapshot.project.revision;
  const savedRevision = saved.base.revision;
  // Portable show imports advance the local revision counter. Compare every authored field
  // exactly, while normalizing only that counter to the revision used for the saved digest.
  // Capture this string before the first await so caller changes cannot alter the comparison.
  const canonical =
    currentRevision === savedRevision
      ? baseSnapshot.canonical
      : canonicalJSON({ ...base, revision: savedRevision }, 'Base project');
  if ((await fingerprint(canonical)) !== saved.base.fingerprint)
    throw new Error(
      'Checkpoint fingerprint mismatch: this project has different authored content from the saved base. Restore the exact original project content before retrying.'
    );
  const events: AgentEvent[] = [];
  const emit = (event: Omit<AgentEvent, 'id' | 'at'>) =>
    events.push({ ...event, id: events.length + 1, at: new Date().toISOString() });
  const state = stateFor(baseSnapshot.project);
  emit({
    type: 'phase',
    message:
      currentRevision === savedRevision
        ? `Verified the checkpoint against the exact saved base at revision ${savedRevision}.`
        : `Verified identical saved base content from revision ${savedRevision} at current revision ${currentRevision}.`,
    details: { savedRevision, currentRevision, fingerprintVerified: true },
  });
  emit({
    type: 'tool_start',
    tool: 'stage_operations',
    message: 'Replaying checkpoint commands into a private draft.',
  });
  stageOperations(
    saved.proposal.operations,
    'Restore a portable draft checkpoint.',
    state,
    defaultAgentLimits
  );
  canonicalJSON(state.project, 'Draft project');
  emit({
    type: 'tool_result',
    tool: 'stage_operations',
    message: `Staged ${state.operations.length} checkpoint commands.`,
    details: { stagedOperations: state.operations.length, baseRevision: currentRevision },
  });
  emit({
    type: 'tool_start',
    tool: 'review_draft',
    message: 'Running a fresh bounded design review.',
  });
  executeAgentTool('review_draft', {}, state, defaultAgentLimits);
  emit({
    type: 'tool_result',
    tool: 'review_draft',
    message: state.reviewLimited
      ? 'Fresh review is incomplete because the draft exceeds the agent review budget.'
      : 'Fresh design review completed; flight readiness is not established.',
    details: { status: state.review?.status || 'incomplete', flightReady: false },
  });
  executeAgentTool(
    'finish_proposal',
    {
      title: saved.proposal.title,
      description: saved.proposal.description,
      changes: saved.proposal.changes,
    },
    state,
    defaultAgentLimits
  );
  emit({
    type: 'completed',
    message: `Checkpoint from revision ${savedRevision} restored as an unapplied, freshly reviewed proposal for revision ${currentRevision}.`,
  });
  return {
    runId: globalThis.crypto.randomUUID(),
    status: 'completed',
    message: `Checkpoint from revision ${savedRevision} restored for current revision ${currentRevision}. Review the proposal before applying it.`,
    proposal: state.proposal!,
    events,
    usage: { inputTokens: 0, outputTokens: 0 },
    ...(state.review ? { review: state.review } : {}),
    ...(state.reviewLimited ? { reviewLimited: true } : {}),
  };
}
