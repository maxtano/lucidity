import { z } from 'zod';
import type { AgentEvent } from '../agent/types';
import './AudienceTargetActivity.css';

const count = z.number().int().min(0).max(100_000);
const operationCount = z.number().int().min(0).max(128);
const targetId = z.string().min(1).max(256);
const criteria = z.object({
  time: z.number().finite().min(0).max(1800),
  region: z.enum(['in_frame', 'front', 'right', 'rear', 'left', 'overhead']),
  lights: z.enum(['any', 'on', 'off']),
  scope: z.enum(['fleet', 'selection']),
});
const target = z.object({
  viewName: z.string().min(1).max(48),
  request: criteria,
  consideredCount: count,
  droneCount: count.min(1),
  stagedOperations: operationCount,
});
const query = target
  .extend({
    matchedCount: count,
    targetId: targetId.nullable().optional(),
    offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    ids: z.array(count.min(1)).max(128),
  })
  .refine(
    (value) =>
      value.matchedCount <= value.consideredCount &&
      value.consideredCount <= value.droneCount &&
      value.ids.length <= Math.max(0, value.matchedCount - value.offset) &&
      value.ids.every(
        (id, index) => id <= value.droneCount && (index === 0 || id > value.ids[index - 1])
      ) &&
      (value.matchedCount > 0
        ? value.targetId !== null
        : value.targetId === null || value.targetId === undefined)
  );
const staged = z
  .object({
    targetId,
    matchedCount: count.min(1),
    addedOperations: operationCount.min(1),
    stagedOperations: operationCount.min(1),
    target,
  })
  .refine(
    (value) =>
      value.matchedCount <= value.target.consideredCount &&
      value.target.consideredCount <= value.target.droneCount &&
      value.target.stagedOperations + value.addedOperations === value.stagedOperations
  );
const stagingTools = new Set([
  'stage_operations',
  'stage_selection_operation',
  'stage_audience_operation',
]);
const regions = {
  in_frame: 'In camera frame',
  front: 'Front',
  right: 'Right',
  rear: 'Rear',
  left: 'Left',
  overhead: 'Overhead',
};
const lights = { any: 'any light state', on: 'lights on', off: 'lights off' };
const number = (value: number) => value.toLocaleString();
const seconds = (value: number) => Number(value.toPrecision(9)).toString();
const criteriaText = (value: z.infer<typeof target>) =>
  `${regions[value.request.region]} · ${lights[value.request.lights]} · ${value.request.scope === 'fleet' ? 'active fleet' : 'original selection'}`;

/** Human-readable trace context only. Exact editable IDs remain in the proposal operations. */
export function AudienceTargetActivity({
  event,
  events = [],
  running = false,
}: {
  event: AgentEvent;
  events?: AgentEvent[];
  running?: boolean;
}) {
  if (event.type !== 'tool_result') return null;
  if (event.tool === 'inspect_audience_selection') {
    const parsed = query.safeParse(event.details);
    if (!parsed.success) return null;
    const data = parsed.data;
    const editedAfter = events.some((later) => {
      if (
        later.id <= event.id ||
        later.type !== 'tool_result' ||
        !stagingTools.has(later.tool ?? '')
      )
        return false;
      const value = later.details as { addedOperations?: unknown } | undefined;
      return operationCount.min(1).safeParse(value?.addedOperations).success;
    });
    const expiry =
      data.targetId === undefined
        ? 'Historical page · no reusable target recorded.'
        : data.targetId === null
          ? 'No matching drones · no target created.'
          : !running
            ? 'Run ended · temporary target unavailable.'
            : editedAfter
              ? 'Target expired after a draft edit.'
              : 'Temporary target · edits or cache limits expire it.';
    const preview = data.ids.slice(0, 8);
    return (
      <div className="audience-target-activity" aria-label="Audience query summary">
        <strong>
          {number(data.matchedCount)} matching drones{' '}
          <span>of {number(data.consideredCount)} considered</span>
        </strong>
        <p>{criteriaText(data)}</p>
        <p>
          {data.viewName} · show {seconds(data.request.time)}s
        </p>
        <p className="audience-target-page">
          {data.ids.length ? (
            <>
              Page {number(data.offset + 1)}–{number(data.offset + data.ids.length)} of{' '}
              {number(data.matchedCount)} · IDs {preview.join(', ')}
              {data.ids.length > preview.length
                ? ` · +${number(data.ids.length - preview.length)} on this page`
                : ''}
            </>
          ) : (
            <>Empty page · {number(data.matchedCount)} total matches</>
          )}
        </p>
        <small>{expiry}</small>
      </div>
    );
  }
  if (event.tool === 'stage_audience_operation') {
    const parsed = staged.safeParse(event.details);
    if (!parsed.success) return null;
    const data = parsed.data;
    return (
      <div
        className="audience-target-activity audience-target-staged"
        aria-label="Audience edit target summary"
      >
        <strong>Edit staged for {number(data.matchedCount)} matched drones</strong>
        <p>{criteriaText(data.target)}</p>
        <p>
          {data.target.viewName} · captured show {seconds(data.target.request.time)}s
        </p>
        <p className="audience-target-page">
          Complete target expanded into exact draft IDs · {data.addedOperations}{' '}
          {data.addedOperations === 1 ? 'operation' : 'operations'} added
        </p>
        <small>
          All temporary audience targets expired after this edit. The show is unchanged until you
          apply the proposal.
        </small>
      </div>
    );
  }
  return null;
}
