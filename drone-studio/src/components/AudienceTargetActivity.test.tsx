import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../agent/types';
import { AudienceTargetActivity } from './AudienceTargetActivity';

function query(): AgentEvent {
  return {
    id: 2,
    at: '',
    type: 'tool_result',
    tool: 'inspect_audience_selection',
    message: 'Completed.',
    details: {
      viewName: 'Rear audience',
      request: { time: 1.25, region: 'in_frame', lights: 'off', scope: 'selection' },
      stagedOperations: 2,
      consideredCount: 300,
      droneCount: 400,
      matchedCount: 133,
      targetId: 'run-target-7',
      offset: 40,
      ids: Array.from({ length: 40 }, (_, i) => i * 3 + 1),
    },
  };
}
function stage(): AgentEvent {
  const details = query().details as Record<string, unknown>;
  return {
    id: 4,
    at: '',
    type: 'tool_result',
    tool: 'stage_audience_operation',
    message: 'Completed.',
    details: {
      targetId: 'run-target-7',
      matchedCount: 133,
      addedOperations: 1,
      stagedOperations: 3,
      target: {
        viewName: details.viewName,
        request: details.request,
        consideredCount: 300,
        droneCount: 400,
        stagedOperations: 2,
      },
    },
  };
}
const render = (event: AgentEvent, events?: AgentEvent[], running = false) =>
  renderToStaticMarkup(<AudienceTargetActivity event={event} events={events} running={running} />);

describe('audience targeting activity summaries', () => {
  it('distinguishes complete matched counts from a bounded ID page and keeps the handle historical', () => {
    const event = query(),
      before = structuredClone(event);
    const html = render(event);
    expect(html).toContain('133 matching drones');
    expect(html).toContain('of 300 considered');
    expect(html).toContain('original selection');
    expect(html).toContain('Rear audience');
    expect(html).toContain('show 1.25s');
    expect(html).toContain('Page 41–80 of 133');
    expect(html).toContain('IDs 1, 4, 7, 10, 13, 16, 19, 22');
    expect(html).toContain('+32 on this page');
    expect(html).not.toContain('25, 28');
    expect(html).toContain('Run ended · temporary target unavailable.');
    expect(html).not.toContain('run-target-7');
    expect(event).toEqual(before);
  });

  it('never promises current handle usability and marks a subsequent successful edit as expiration', () => {
    const event = query();
    expect(render(event, [event], true)).toContain('edits or cache limits expire it');
    expect(render(event, [event, stage()], true)).toContain('Target expired after a draft edit.');
    expect(render(event, [event, { ...stage(), type: 'validation_error' }], true)).toContain(
      'edits or cache limits expire it'
    );
    expect(render(event, [event, { ...stage(), tool: 'stage_operations' }], true)).toContain(
      'Target expired after a draft edit.'
    );
  });

  it('distinguishes a zero-match query from an empty page of a reusable full target', () => {
    const event = query();
    Object.assign(event.details as object, { ids: [], offset: 133 });
    expect(render(event, [], true)).toContain('Empty page · 133 total matches');
    expect(render(event, [], true)).toContain('Temporary target');
    Object.assign(event.details as object, { targetId: null, matchedCount: 0, offset: 0 });
    expect(render(event, [], true)).toContain('No matching drones · no target created.');
  });

  it('describes a staged full target using captured baseline criteria while remaining explicit about the unapplied draft', () => {
    const html = render(stage());
    expect(html).toContain('Edit staged for 133 matched drones');
    expect(html).toContain('captured show 1.25s');
    expect(html).toContain('Complete target expanded into exact draft IDs · 1 operation added');
    expect(html).toContain('All temporary audience targets expired after this edit.');
    expect(html).toContain('The show is unchanged until you apply the proposal.');
  });

  it('keeps legacy page summaries useful without implying a reusable handle', () => {
    const event = query();
    Reflect.deleteProperty(event.details as object, 'targetId');
    expect(render(event)).toContain('Historical page · no reusable target recorded.');
  });

  it('omits malformed or non-successful evidence instead of presenting invented target claims', () => {
    const invalid = [
      { matchedCount: 301 },
      { ids: [1, 1] },
      { ids: [401] },
      { targetId: null },
      { ids: Array.from({ length: 129 }, (_, i) => i + 1) },
    ];
    for (const patch of invalid) {
      const event = query();
      Object.assign(event.details as object, patch);
      expect(render(event)).toBe('');
    }
    expect(render({ ...query(), type: 'tool_start' })).toBe('');
    expect(render({ ...query(), type: 'validation_error' })).toBe('');
    expect(render({ ...query(), details: null })).toBe('');
    expect(render({ ...query(), tool: 'sample_frame' })).toBe('');
    const invalidStage = stage();
    Object.assign(invalidStage.details as object, { stagedOperations: 4 });
    expect(render(invalidStage)).toBe('');
  });
});
