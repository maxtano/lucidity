import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProposalTargetControls, type ProposalTargetControlsProps } from './ProposalTargetControls';
import type { DraftPreviewSceneTargets } from '../agent/draft-preview-targets';

const props = (): ProposalTargetControlsProps => ({
  target: { projectId: 'show', revision: 7, droneCount: 400, ids: [1, 3, 200] },
  totalCount: 5,
  perDroneOperations: 4,
  otherOperations: 2,
  versionLabel: 'Before',
  enabled: false,
  onToggle: vi.fn(),
});

describe('proposal target controls', () => {
  it('distinguishes complete target membership from active and inactive IDs in this version', () => {
    const input = props();
    const html = renderToStaticMarkup(<ProposalTargetControls {...input} />);
    expect(html).toContain('5 targeted drones');
    expect(html).toContain('<b>Before</b> · 3 / 5 active · 2 inactive');
    expect(html).toContain('Per-drone operation targets · all scenes');
    expect(html).toContain('4 per-drone operations in all scenes');
    expect(html).toContain('2 other operations in the whole proposal are not marked');
    expect(html).toContain('may have no visible change at this playhead');
    expect(html).toContain('Scene and show operations can change other');
    expect(input.target.ids).toEqual([1, 3, 200]);
    expect(input.onToggle).not.toHaveBeenCalled();
  });

  it('keeps default-off membership visible and labels toggle state accessibly', () => {
    const input = props();
    const hidden = renderToStaticMarkup(<ProposalTargetControls {...input} />);
    expect(hidden).toContain('aria-label="Show proposal target markers" aria-pressed="false"');
    expect(hidden).toContain('Show marks');
    expect(hidden).not.toContain('disabled=""');
    const enabled = renderToStaticMarkup(
      <ProposalTargetControls {...input} enabled versionLabel="Draft" />
    );
    expect(enabled).toContain('aria-pressed="true"');
    expect(enabled).toContain('Hide marks');
    expect(enabled).toContain('<b>Draft</b>');
  });

  it('shows all-inactive targets honestly and disables a toggle that cannot mark this version', () => {
    const input = props();
    const html = renderToStaticMarkup(
      <ProposalTargetControls {...input} target={{ ...input.target, ids: [] }} />
    );
    expect(html).toContain('5 targeted drones');
    expect(html).toContain('0 / 5 active · 5 inactive');
    expect(html).toContain('disabled=""');
    expect(html).toContain('No targeted IDs are active in this version.');
    const enabled = renderToStaticMarkup(
      <ProposalTargetControls {...input} target={{ ...input.target, ids: [] }} enabled />
    );
    expect(enabled).toContain('Hide marks');
    expect(enabled).not.toContain('disabled=""');
  });

  it('states display and capture limitations without exposing any selection or edit action', () => {
    const html = renderToStaticMarkup(<ProposalTargetControls {...props()} />);
    expect(html).toContain('including lights that are off');
    expect(html).toContain('ignore venue occlusion');
    expect(html).toContain('stay out of captured review frames');
    expect(html).toContain('do not change selection, authored lights, or show timing');
    expect(html).not.toContain('Apply');
    expect(html).not.toContain('Replace selection');
    expect((html.match(/<button/g) ?? []).length).toBe(1);
  });

  const scene = (
    cueId: string,
    nameBefore: string | null,
    nameAfter: string | null,
    ids: readonly number[] = [1, 3]
  ): DraftPreviewSceneTargets => ({
    cueId,
    nameBefore,
    nameAfter,
    ids,
    perDroneOperations: 2,
    base: { projectId: 'show', revision: 7, droneCount: 400, ids },
    draft: { projectId: 'show', revision: 8, droneCount: 400, ids },
  });
  const scopedProps = (): ProposalTargetControlsProps => {
    const selected = scene('opening', 'Opening', 'Aurora');
    return {
      ...props(),
      target: selected.base,
      totalCount: selected.ids.length,
      overallCount: 5,
      perDroneOperations: selected.perDroneOperations,
      sceneScope: {
        cueId: selected.cueId,
        scenes: [selected],
        frame: { role: 'current', currentSceneName: 'Opening', transitionSourceName: null },
        onChange: vi.fn(),
      },
    };
  };

  it('distinguishes fixed command-scene membership from the full proposal and whole-proposal broad operations', () => {
    const input = scopedProps();
    const html = renderToStaticMarkup(<ProposalTargetControls {...input} />);
    expect(html).toContain('2 targeted drones');
    expect(html).toContain('2 of 5 proposal targets · fixed scene scope');
    expect(html).toContain('2 per-drone operations in this scope');
    expect(html).toContain('2 other operations in the whole proposal are not marked');
    expect(html).toContain('aria-label="Proposal target scene"');
    expect(html).toContain('<option value="opening" selected="">Opening → Aurora</option>');
    expect(html).toContain('<strong>Current scene</strong> · Opening');
    expect(html).toContain('commands in the chosen scene');
    expect(html).toContain('Choosing a command scene does not seek or recall its formation');
    expect(input.onToggle).not.toHaveBeenCalled();
    expect(input.sceneScope!.onChange).not.toHaveBeenCalled();
    expect(input.target.ids).toEqual([1, 3]);
  });

  it('offers all scenes and labels renamed, added, removed and transient scene records explicitly', () => {
    const input = scopedProps();
    const html = renderToStaticMarkup(
      <ProposalTargetControls
        {...input}
        sceneScope={{
          ...input.sceneScope!,
          cueId: null,
          frame: null,
          scenes: [
            scene('rename', 'Opening', 'Aurora'),
            scene('added', null, 'New finale'),
            scene('removed', 'Old finale', null),
            scene('transient', null, null),
          ],
        }}
      />
    );
    expect(html).toContain('<option value="" selected="">All scenes</option>');
    expect(html).toContain('Opening → Aurora');
    expect(html).toContain('Added · New finale');
    expect(html).toContain('Removed · Old finale');
    expect(html).toContain('Absent in both versions · transient');
    expect(html).not.toContain('fixed scene scope');
  });

  it.each([
    ['incoming-source', 'Incoming transition source', 'Opening → Finale'],
    ['outside-frame', 'Other scene at playhead', 'Showing Finale'],
    ['absent', 'Scene absent in Draft', 'Active IDs still follow their current positions.'],
  ] as const)(
    'explains the %s relationship without presenting a past formation',
    (role, label, detail) => {
      const input = scopedProps();
      const html = renderToStaticMarkup(
        <ProposalTargetControls
          {...input}
          versionLabel="Draft"
          sceneScope={{
            ...input.sceneScope!,
            frame: {
              role,
              currentSceneName: 'Finale',
              transitionSourceName: role === 'incoming-source' ? 'Opening' : null,
            },
          }}
        />
      );
      expect(html).toContain(`<strong>${label}</strong>`);
      expect(html).toContain(detail);
      expect(html).toContain('A targeted drone may have no visible change at this playhead');
      expect(html).not.toContain('Seek');
      expect(input.sceneScope!.onChange).not.toHaveBeenCalled();
    }
  );

  it('retains navigation for an empty scene scope and permits hiding an enabled overlay', () => {
    const input = scopedProps();
    const empty = scene('empty', 'Empty reset', 'Empty reset', []);
    const html = renderToStaticMarkup(
      <ProposalTargetControls
        {...input}
        target={empty.base}
        totalCount={0}
        enabled
        sceneScope={{ ...input.sceneScope!, cueId: empty.cueId, scenes: [empty] }}
      />
    );
    expect(html).toContain('0 targeted drones');
    expect(html).toContain('0 of 5 proposal targets · fixed scene scope');
    expect(html).toContain('0 / 0 active · 0 inactive');
    expect(html).toContain('<option value="">All scenes</option>');
    expect(html).toContain('Hide marks');
    expect(html).not.toContain('disabled=""');
  });
});
