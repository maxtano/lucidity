import { describe, expect, it } from 'vitest';
import { applyOperations } from '../core/commands';
import { parseProjectFile, projectBundle } from '../core/export';
import { defaultProject, type Project } from '../core/model';
import type { AgentProposal } from './types';
import {
  createProposalCheckpoint,
  MAX_CHECKPOINT_BYTES,
  parseProposalCheckpoint,
  restoreProposalCheckpoint,
  serializeProposalCheckpoint,
  type ProposalCheckpoint,
} from './checkpoint';

function fixture() {
  const base = structuredClone(defaultProject);
  base.id = 'checkpoint-test';
  base.revision = 9;
  base.droneCount = 4;
  base.cues = [
    {
      ...base.cues[0],
      duration: 4,
      transition: 0,
      metadata: { layer: { label: 'Original', enabled: true }, tags: ['one', 'two'] },
      droneEdits: { 2: { position: [4, -2, 45], brightness: 0.7 } },
    },
  ];
  const proposal: AgentProposal = {
    projectId: base.id,
    revision: base.revision,
    title: 'Blue light study',
    description: 'Color selected lights while preserving their motion.',
    changes: ['Set drones 1 and 2 to blue'],
    operations: [
      { type: 'edit_drones', cueId: base.cues[0].id, ids: [1, 2], patch: { color: '#00bbff' } },
    ],
  };
  return { base, proposal };
}

function reorderObjects(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reorderObjects);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, item]) => [key, reorderObjects(item)])
    );
  return value;
}

describe('portable proposal checkpoints', () => {
  it('round-trips only proposal content and restores an unapplied freshly reviewed proposal', async () => {
    const { base, proposal } = fixture();
    const before = structuredClone({ base, proposal });
    const checkpoint = await createProposalCheckpoint(base, proposal);
    expect(Object.keys(checkpoint).sort()).toEqual([
      'base',
      'createdAt',
      'format',
      'proposal',
      'version',
    ]);
    expect(Object.keys(checkpoint.proposal).sort()).toEqual([
      'changes',
      'description',
      'operations',
      'title',
    ]);
    expect(checkpoint.base).toMatchObject({ projectId: base.id, revision: 9 });
    expect(checkpoint.base.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    checkpoint.createdAt = '2000-01-01T00:00:00.000Z';
    const imported = parseProposalCheckpoint(serializeProposalCheckpoint(checkpoint));
    expect(imported).toEqual(checkpoint);
    const checkpointBefore = structuredClone(imported);
    const began = Date.now();
    const result = await restoreProposalCheckpoint(base, imported);
    expect(result.status).toBe('completed');
    expect(result.proposal).toEqual(proposal);
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(result.review?.flightReady).toBe(false);
    expect(Date.parse(result.review!.checkedAt)).toBeGreaterThanOrEqual(began);
    expect(result.events.some((event) => event.tool === 'review_draft')).toBe(true);
    expect({ base, proposal }).toEqual(before);
    expect(imported).toEqual(checkpointBefore);
    const applied = applyOperations(base, result.proposal!.operations, result.proposal!.revision);
    expect(applied.revision).toBe(10);
    expect(applied.cues[0].droneEdits![2]).toEqual({
      position: [4, -2, 45],
      brightness: 0.7,
      color: '#00bbff',
    });
    expect(base.revision).toBe(9);
  });

  it('hashes stable object order while preserving all nested content and array order', async () => {
    const { base, proposal } = fixture();
    const checkpoint = await createProposalCheckpoint(base, proposal);
    const reordered = reorderObjects(base) as Project;
    expect((await createProposalCheckpoint(reordered, proposal)).base.fingerprint).toBe(
      checkpoint.base.fingerprint
    );
    expect((await restoreProposalCheckpoint(reordered, checkpoint)).status).toBe('completed');
    const changed = structuredClone(base);
    changed.cues[0].metadata!.tags = ['two', 'one'];
    await expect(restoreProposalCheckpoint(changed, checkpoint)).rejects.toThrow(
      /fingerprint mismatch/
    );
    changed.cues[0].metadata!.tags = ['one', 'two'];
    (changed.cues[0].metadata!.layer as { label: string }).label = 'Changed';
    await expect(restoreProposalCheckpoint(changed, checkpoint)).rejects.toThrow(
      /fingerprint mismatch/
    );
  });

  it('restores exported/imported identical content against its current revision', async () => {
    const { base, proposal } = fixture();
    const exportedCheckpoint = serializeProposalCheckpoint(
      await createProposalCheckpoint(base, proposal)
    );
    const exportedShow = JSON.stringify(projectBundle(base, null));
    for (const revision of [10, 1]) {
      const importedBase = parseProjectFile(exportedShow);
      importedBase.revision = revision;
      const before = structuredClone(importedBase);
      const result = await restoreProposalCheckpoint(
        importedBase,
        parseProposalCheckpoint(exportedCheckpoint)
      );
      expect(result.status).toBe('completed');
      expect(result.proposal).toEqual({ ...proposal, revision });
      expect(result.review?.revision).toBe(revision + 1);
      expect(result.events[0].details).toEqual({
        savedRevision: 9,
        currentRevision: revision,
        fingerprintVerified: true,
      });
      expect(result.message).toContain(`revision 9 restored for current revision ${revision}`);
      expect(
        applyOperations(importedBase, result.proposal!.operations, result.proposal!.revision)
          .revision
      ).toBe(revision + 1);
      expect(() => applyOperations(importedBase, proposal.operations, proposal.revision)).toThrow(
        /out of date/
      );
      expect(importedBase).toEqual(before);
    }
  });

  it('rejects wrong projects and changed content at either the same or a different revision', async () => {
    const { base, proposal } = fixture();
    const checkpoint = await createProposalCheckpoint(base, proposal);
    await expect(
      restoreProposalCheckpoint({ ...base, id: 'another-project' }, checkpoint)
    ).rejects.toThrow(/different project/);
    const changed = structuredClone(base);
    changed.cues[0].droneEdits![2].position![0] += 1;
    await expect(restoreProposalCheckpoint(changed, checkpoint)).rejects.toThrow(
      /fingerprint mismatch/
    );
    changed.revision = 10;
    await expect(restoreProposalCheckpoint(changed, checkpoint)).rejects.toThrow(
      /fingerprint mismatch/
    );
    await expect(
      createProposalCheckpoint(base, { ...proposal, projectId: 'wrong' })
    ).rejects.toThrow(/different project/);
    await expect(createProposalCheckpoint(base, { ...proposal, revision: 8 })).rejects.toThrow(
      /stale/
    );
  });

  it('rejects incompatible headers, extra runtime fields, and imported review evidence', async () => {
    const { base, proposal } = fixture();
    const checkpoint = await createProposalCheckpoint(base, proposal);
    const invalid = [
      { ...checkpoint, format: 'some-other-format' },
      { ...checkpoint, version: 2 },
      { ...checkpoint, createdAt: 'yesterday' },
      { ...checkpoint, base: { ...checkpoint.base, fingerprint: 'not-a-sha256' } },
      { ...checkpoint, base: { ...checkpoint.base, algorithm: 'SHA-256' } },
      { ...checkpoint, review: { flightReady: true } },
      { ...checkpoint, apiKey: 'synthetic-secret' },
      { ...checkpoint, proposal: { ...checkpoint.proposal, events: [{ type: 'reasoning' }] } },
    ];
    for (const value of invalid)
      expect(() => parseProposalCheckpoint(JSON.stringify(value))).toThrow(/Invalid checkpoint/);
    await expect(restoreProposalCheckpoint(base, invalid[5] as ProposalCheckpoint)).rejects.toThrow(
      /Invalid checkpoint/
    );
    await expect(
      createProposalCheckpoint(base, { ...proposal, apiKey: 'synthetic-secret' } as AgentProposal)
    ).rejects.toThrow(/Invalid proposal/);
  });

  it('rejects unknown operation properties at every level instead of silently stripping them', async () => {
    const { base, proposal } = fixture();
    const checkpoint = await createProposalCheckpoint(base, proposal);
    for (const operation of [
      {
        type: 'edit_drones',
        cueId: base.cues[0].id,
        ids: [1],
        patch: { color: '#00bbff' },
        unexpected: true,
      },
      {
        type: 'edit_drones',
        cueId: base.cues[0].id,
        ids: [1],
        patch: { color: '#00bbff', unexpected: true },
      },
      {
        type: 'edit_drones',
        cueId: base.cues[0].id,
        ids: [1],
        patch: { flash: { hz: 2, duty: 0.5, phase: 0, unexpected: true } },
      },
    ]) {
      const invalid = {
        ...checkpoint,
        proposal: { ...checkpoint.proposal, operations: [operation] },
      };
      expect(() => parseProposalCheckpoint(JSON.stringify(invalid))).toThrow(/Unknown field/);
      expect(() => serializeProposalCheckpoint(invalid as ProposalCheckpoint)).toThrow(
        /Unknown field/
      );
    }
    const unknownUndefined = {
      ...checkpoint,
      proposal: {
        ...checkpoint.proposal,
        operations: [{ ...checkpoint.proposal.operations[0], unknown: undefined }],
      },
    };
    expect(() => serializeProposalCheckpoint(unknownUndefined as ProposalCheckpoint)).toThrow(
      /Unknown field/
    );
  });

  it('validates imported operations and replays cross-field project constraints atomically', async () => {
    const { base, proposal } = fixture();
    const checkpoint = await createProposalCheckpoint(base, proposal);
    const before = structuredClone(base);
    for (const operations of [
      [],
      [{ type: 'run_shell', command: 'anything' }],
      [{ type: 'set_fleet', count: 0 }],
      Array.from({ length: 129 }, () => ({ type: 'rename', name: 'Too many' })),
    ]) {
      expect(() =>
        parseProposalCheckpoint(
          JSON.stringify({ ...checkpoint, proposal: { ...checkpoint.proposal, operations } })
        )
      ).toThrow(/Invalid checkpoint/);
    }
    const invalidScene = parseProposalCheckpoint(
      JSON.stringify({
        ...checkpoint,
        proposal: {
          ...checkpoint.proposal,
          operations: [
            { type: 'rename', name: 'Must not leak' },
            { type: 'update_cue', id: base.cues[0].id, patch: { transition: 5 } },
          ],
        },
      })
    );
    await expect(restoreProposalCheckpoint(base, invalidScene)).rejects.toThrow(
      /Transition must fit/
    );
    expect(base).toEqual(before);
    await expect(
      createProposalCheckpoint(base, { ...proposal, operations: invalidScene.proposal.operations })
    ).rejects.toThrow(/Transition must fit/);
  });

  it('enforces the shared conservative expansion budget on create and restore', async () => {
    const { base, proposal } = fixture();
    base.droneCount = 100000;
    const checkpoint = await createProposalCheckpoint(base, proposal);
    const oversizedProposal: AgentProposal = {
      ...proposal,
      operations: [
        {
          type: 'edit_drones',
          cueId: base.cues[0].id,
          ids: Array.from({ length: 100000 }, (_, index) => index + 1),
          patch: {
            keyframes: Array.from({ length: 400 }, (_, time) => ({ time, color: '#aabbcc' })),
          },
        },
      ],
    };
    await expect(createProposalCheckpoint(base, oversizedProposal)).rejects.toThrow(
      /draft expansion budget/
    );
    const imported = parseProposalCheckpoint(
      JSON.stringify({
        ...checkpoint,
        proposal: { ...checkpoint.proposal, operations: oversizedProposal.operations },
      })
    );
    await expect(restoreProposalCheckpoint(base, imported)).rejects.toThrow(
      /draft expansion budget/
    );
    expect(base.cues[0].droneEdits).toEqual({ 2: { position: [4, -2, 45], brightness: 0.7 } });
  });

  it('checks UTF-8 byte limits on text, serialization, and the base snapshot', async () => {
    const { base, proposal } = fixture();
    const checkpoint = await createProposalCheckpoint(base, proposal);
    expect(() => parseProposalCheckpoint(' '.repeat(MAX_CHECKPOINT_BYTES + 1))).toThrow(
      /32 MB UTF-8/
    );
    const unicode = '夜'.repeat(Math.floor(MAX_CHECKPOINT_BYTES / 3) + 1);
    expect(unicode.length).toBeLessThan(MAX_CHECKPOINT_BYTES);
    expect(() => parseProposalCheckpoint(unicode)).toThrow(/32 MB UTF-8/);
    const invalid = {
      ...checkpoint,
      proposal: {
        ...checkpoint.proposal,
        operations: [
          { type: 'update_cue', id: base.cues[0].id, patch: { metadata: { note: unicode } } },
        ],
      },
    } as ProposalCheckpoint;
    expect(() => serializeProposalCheckpoint(invalid)).toThrow(/32 MB UTF-8/);
    base.cues[0].metadata = { note: unicode };
    await expect(createProposalCheckpoint(base, proposal)).rejects.toThrow(
      /Base project exceeds the 32 MB UTF-8/
    );
  });

  it('allows the exact input-byte boundary but rejects the next byte before JSON parsing', async () => {
    const { base, proposal } = fixture();
    const text = serializeProposalCheckpoint(await createProposalCheckpoint(base, proposal));
    const exact =
      text + ' '.repeat(MAX_CHECKPOINT_BYTES - new TextEncoder().encode(text).byteLength);
    expect(parseProposalCheckpoint(exact).base.projectId).toBe(base.id);
    expect(() => parseProposalCheckpoint(exact + ' ')).toThrow(/32 MB UTF-8/);
  });

  it('rejects malformed JSON, deep nesting, circular data, and non-JSON snapshot values', async () => {
    const { base, proposal } = fixture();
    expect(() => parseProposalCheckpoint('{bad')).toThrow(/not valid JSON/);
    for (const value of [NaN, Infinity, BigInt(1), new Date(), () => 'not JSON']) {
      base.cues[0].metadata = { invalid: value };
      await expect(createProposalCheckpoint(base, proposal)).rejects.toThrow(/non-JSON|non-finite/);
    }
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    base.cues[0].metadata = circular;
    await expect(createProposalCheckpoint(base, proposal)).rejects.toThrow(/circular/);
    let nested: unknown = 'end';
    for (let index = 0; index < 130; index++) nested = { child: nested };
    base.cues[0].metadata = { nested };
    await expect(createProposalCheckpoint(base, proposal)).rejects.toThrow(/nesting depth/);
  });

  it('rejects unknown base project fields rather than hashing discarded content', async () => {
    const { base, proposal } = fixture();
    const unknownBase = { ...base, unexpected: true } as Project;
    await expect(createProposalCheckpoint(unknownBase, proposal)).rejects.toThrow(/Unknown field/);
    const unknownDrone = structuredClone(base);
    Object.assign(unknownDrone.cues[0].droneEdits![2], { ignoredChannel: 123 });
    await expect(createProposalCheckpoint(unknownDrone, proposal)).rejects.toThrow(/Unknown field/);
  });

  it('rechecks large drafts within the review budget without inventing flight metrics', async () => {
    const { base, proposal } = fixture();
    base.droneCount = 100000;
    base.cues = Array.from({ length: 32 }, (_, index) => ({
      ...base.cues[0],
      id: `scene-${index}`,
      duration: 1,
      transition: 0,
    }));
    const checkpoint = await createProposalCheckpoint(base, {
      ...proposal,
      operations: [{ type: 'rename', name: 'Large draft' }],
    });
    const result = await restoreProposalCheckpoint(base, checkpoint);
    expect(result.status).toBe('completed');
    expect(result.reviewLimited).toBe(true);
    expect(result.review).toBeUndefined();
    expect(
      result.events.some(
        (event) => event.tool === 'review_draft' && event.message.includes('budget')
      )
    ).toBe(true);
    expect(base.name).toBe(defaultProject.name);
  });

  it('owns its snapshots across asynchronous hashing and does not retain caller-owned command objects', async () => {
    const { base, proposal } = fixture();
    const original = structuredClone(base);
    const pending = createProposalCheckpoint(base, proposal);
    base.name = 'Changed after capture';
    proposal.title = 'Changed after capture';
    proposal.operations.length = 0;
    const checkpoint = await pending;
    expect(checkpoint.proposal.title).toBe('Blue light study');
    expect(checkpoint.proposal.operations).toHaveLength(1);
    const restoring = restoreProposalCheckpoint(original, checkpoint);
    checkpoint.proposal.operations.length = 0;
    const restored = await restoring;
    expect(restored.proposal?.operations).toHaveLength(1);
    expect(original.name).toBe(defaultProject.name);
  });
});
