import { applyOperations, type Operation } from '../core/commands';
import { defaultProject, type Project, type Vector3Tuple } from '../core/model';
import { runAgent } from './harness';
import { audienceEvaluation, createAudienceEvaluationProvider } from './evaluation-audience';
import { cameraEvaluation, createCameraEvaluationProvider } from './evaluation-camera';
import { targetingEvaluation, createTargetingEvaluationProvider } from './evaluation-targeting';
import {
  evaluateAudienceTargeting,
  type AudienceTargetingEvidence,
} from './evaluation-targeting-oracle';
import {
  evaluateCameraRefinement,
  type CameraRefinementEvidence,
} from './evaluation-camera-oracle';
import {
  evaluateAudienceRefinement,
  type AudienceRefinementEvidence,
} from './evaluation-audience-oracle';
import type { AgentEvent, AgentProposal, AgentProvider, AgentRequest, AgentUsage } from './types';

export type EvaluationFinding = { name: string; passed: boolean; detail: string };
export type EvaluationCaseResult = {
  id: string;
  title: string;
  status: 'passed' | 'failed' | 'cancelled';
  durationMs: number;
  usage: AgentUsage;
  context: { projectId: string; revision: number; selectedCount: number; droneCount: number };
  findings: EvaluationFinding[];
  audienceEvidence?: AudienceRefinementEvidence;
  cameraEvidence?: CameraRefinementEvidence;
  targetingEvidence?: AudienceTargetingEvidence;
  run: {
    runId: string;
    status: 'completed' | 'cancelled' | 'failed';
    message: string;
    events: AgentEvent[];
    proposal?: AgentProposal;
  };
};
export type EvaluationReport = {
  version: 1;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: 'passed' | 'failed' | 'cancelled';
  summary: { total: number; passed: number; failed: number; cancelled: number; skipped: number };
  usage: AgentUsage;
  cases: EvaluationCaseResult[];
};

type Fixture = {
  request: AgentRequest;
  expected: Project;
  operations: Operation[];
  fullSelection?: boolean;
};
type Definition = { id: string; title: string; prompt: string; fixture: () => Fixture };

function baseRequest(sceneCount = 1): AgentRequest {
  const project = structuredClone(defaultProject);
  project.id = 'evaluation-fixture';
  project.name = 'Evaluation fixture';
  project.revision = 7;
  project.droneCount = 8;
  project.bpm = 120;
  project.cues = project.cues.slice(0, sceneCount);
  project.cues.forEach((cue, index) => {
    cue.id = index ? 'detail' : 'opening';
    cue.name = index ? 'Detail' : 'Opening';
    cue.duration = index ? 12 : 7;
    cue.transition = index ? 4 : 0;
    cue.metadata = { note: 'Preserve this authored note.' };
  });
  return { project, prompt: '', cueId: project.cues.at(-1)!.id, selection: [2, 5], time: 2 };
}

const definitions: Definition[] = [
  {
    id: 'selected-lights',
    title: 'Selected light channels preserve unrelated work',
    prompt:
      'In Opening, set the static base color of every selected drone to #00bbff and its static flashing to 2 Hz, duty 0.25, phase 0.125. Preserve positions, brightness, every existing keyframe, other drones, scene settings, and all other show content.',
    fixture() {
      const request = baseRequest();
      request.project.cues[0].droneEdits = {
        2: {
          position: [10, -3, 50],
          brightness: 0.65,
          color: '#aa3311',
          flash: { hz: 1, duty: 0.5, phase: 0 },
          keyframes: [
            { time: 0, brightness: 0.2 },
            { time: 4, brightness: 0.8, easing: 'hold' },
          ],
        },
        5: { position: [-10, 8, 60], brightness: 0.8 },
        7: { color: '#ffbb00', position: [15, 5, 45], keyframes: [{ time: 1, brightness: 0.3 }] },
      };
      const expected = structuredClone(request.project);
      for (const id of request.selection) {
        expected.cues[0].droneEdits![id].color = '#00bbff';
        expected.cues[0].droneEdits![id].flash = { hz: 2, duty: 0.25, phase: 0.125 };
      }
      return {
        request,
        expected,
        fullSelection: true,
        operations: [
          {
            type: 'edit_drones',
            cueId: request.cueId,
            ids: [...request.selection],
            patch: { color: '#00bbff', flash: { hz: 2, duty: 0.25, phase: 0.125 } },
          },
        ],
      };
    },
  },
  {
    id: 'complete-selection',
    title: 'Every ID in a large irregular selection is edited',
    prompt:
      'Set static brightness to 0.42 for EVERY drone in the captured selection, including IDs beyond the initial preview. The selected IDs are irregular, not a numeric range. Preserve the fleet count, all other drone properties, unselected drones, and all scene/show settings.',
    fixture() {
      const request = baseRequest();
      request.project.droneCount = 997;
      request.selection = Array.from({ length: 333 }, (_, index) => ((index * 613 + 89) % 997) + 1);
      const outside = Array.from({ length: 997 }, (_, index) => index + 1).find(
        (id) => !request.selection.includes(id)
      )!;
      request.project.cues[0].droneEdits = {
        [request.selection[0]]: { color: '#ccaa22', position: [2, 3, 44] },
        [outside]: { brightness: 0.9, color: '#ff0088' },
      };
      const expected = structuredClone(request.project);
      for (const id of request.selection)
        expected.cues[0].droneEdits![id] = {
          ...expected.cues[0].droneEdits![id],
          brightness: 0.42,
        };
      return {
        request,
        expected,
        fullSelection: true,
        operations: [
          {
            type: 'edit_drones',
            cueId: request.cueId,
            ids: [...request.selection],
            patch: { brightness: 0.42 },
          },
        ],
      };
    },
  },
  {
    id: 'scene-retime',
    title: 'Retiming includes dormant drone and trimmed keys',
    prompt:
      'Make Detail run at 2× its current speed. Halve its duration, its incoming transition, and every authored keyframe time. Include dormant drone 11 and keys beyond the scene end; retain those keys. Preserve their other channels/easing, the fleet count, Opening, and every other setting.',
    fixture() {
      const request = baseRequest(2);
      request.selection = [2];
      request.time = 10;
      request.project.cues[0].droneEdits = {
        2: { color: '#113355', keyframes: [{ time: 2, brightness: 0.7 }] },
      };
      request.project.cues[1].droneEdits = {
        2: {
          color: '#ffaa11',
          keyframes: [
            { time: 2, brightness: 0.4, easing: 'smooth' },
            { time: 8, position: [10, 4, 50] },
            { time: 16, brightness: 0.9 },
          ],
        },
        11: {
          position: [8, -5, 55],
          keyframes: [
            { time: 3, color: '#1188ff' },
            { time: 15, brightness: 0.2, easing: 'hold' },
          ],
        },
      };
      const expected = structuredClone(request.project);
      expected.cues[1].duration = 6;
      expected.cues[1].transition = 2;
      for (const edit of Object.values(expected.cues[1].droneEdits!))
        for (const key of edit.keyframes || []) key.time *= 0.5;
      return {
        request,
        expected,
        operations: [
          {
            type: 'retime_cue',
            id: request.cueId,
            speed: 2,
            scaleKeyframes: true,
            scaleTransition: true,
          },
        ],
      };
    },
  },
  {
    id: 'beat-transition',
    title: 'Tempo-aware transition length and easing',
    prompt:
      'Set the show tempo to 160 BPM. Set the incoming transition of Detail to exactly 6 beats at that new tempo and use ease-out transition easing. Preserve scene durations, key times/channels, drone data, Opening, and all other settings.',
    fixture() {
      const request = baseRequest(2);
      request.project.cues[1].transitionEasing = 'linear';
      request.project.cues[1].droneEdits = {
        2: {
          keyframes: [
            { time: 1, brightness: 0.3 },
            { time: 8, color: '#cc22aa', easing: 'hold' },
          ],
        },
      };
      const expected = structuredClone(request.project);
      expected.bpm = 160;
      expected.cues[1].transition = 2.25;
      expected.cues[1].transitionEasing = 'ease-out';
      return {
        request,
        expected,
        operations: [
          { type: 'set_tempo', bpm: 160 },
          { type: 'transition_to_beats', id: request.cueId, beats: 6 },
          { type: 'update_cue', id: request.cueId, patch: { transitionEasing: 'ease-out' } },
        ],
      };
    },
  },
  {
    id: 'position-at-playhead',
    title: 'Global playhead maps to the correct local position key',
    prompt:
      'At the current SHOW-global playhead of 11 seconds, change only selected drone 3’s position key in Detail to [12, -6, 48] metres East/North/Up. Detail begins after the 7-second Opening. Preserve the existing key’s easing and light channels, other keys, static properties, other drones, and all scene/show settings.',
    fixture() {
      const request = baseRequest(2);
      request.selection = [3];
      request.time = 11;
      request.project.cues[1].droneEdits = {
        3: {
          color: '#112244',
          brightness: 0.6,
          position: [1, 1, 40],
          keyframes: [
            { time: 0, position: [2, 2, 42] },
            { time: 4, position: [5, 3, 44], easing: 'hold', color: '#ffaa11', brightness: 0.8 },
            { time: 8, position: [-4, 2, 45], color: '#ff1155' },
          ],
        },
        4: { keyframes: [{ time: 4, position: [4, 2, 47] }] },
      };
      const expected = structuredClone(request.project);
      expected.cues[1].droneEdits![3].keyframes![1].position = [12, -6, 48];
      return {
        request,
        expected,
        fullSelection: true,
        operations: [
          {
            type: 'set_keyframe',
            cueId: request.cueId,
            ids: [3],
            keyframe: { time: 4, position: [12, -6, 48] },
          },
        ],
      };
    },
  },
  {
    id: 'group-path-transform',
    title: 'Pivot rotation and nonuniform scale preserve complete selected paths',
    prompt:
      'In Detail, transform EVERY drone in the captured irregular selection, including all IDs beyond the initial 128-ID preview, and also dormant authored drone 311. Use the explicit ENU pivot [10,-4,30]. For every static base position and EVERY authored position key, first scale pivot-relative coordinates by [-2,3,0.5], then rotate +90 degrees right-handed around the Up axis [0,0,1], then translate [4,5,-2] metres after restoring the pivot. Include position keys beyond the scene end. Preserve all key times, easing, light channels, unselected drones, Opening, fleet count, and all scene/show settings. Negative East scale is intentional. Do not create or remove keys.',
    fixture() {
      const request = baseRequest(2);
      request.project.droneCount = 257;
      request.selection = Array.from({ length: 173 }, (_, index) => ((index * 89 + 13) % 257) + 1);
      request.time = 9;
      const outside = Array.from({ length: 257 }, (_, index) => index + 1).find(
        (id) => !request.selection.includes(id)
      )!;
      request.project.cues[0].droneEdits = {
        [request.selection[0]]: {
          position: [3, 7, 40],
          keyframes: [{ time: 2, color: '#abcdef' }],
        },
      };
      request.project.cues[1].droneEdits = Object.fromEntries(
        [...request.selection, 311].map((id) => {
          const x = (id % 17) - 8,
            y = (Math.floor(id / 17) % 11) - 5,
            z = 30 + (id % 7);
          return [
            id,
            {
              position: [x, y, z],
              color: '#cc8833',
              brightness: 0.6,
              flash: { hz: 1.5, duty: 0.4, phase: 0.125 },
              keyframes: [
                { time: 0, position: [x + 1, y - 2, z + 4], easing: 'smooth', brightness: 0.2 },
                { time: 3, color: '#aabbff', flash: { hz: 2, duty: 0.3, phase: 0.5 } },
                { time: 18, position: [x - 3, y + 4, z + 8], easing: 'hold', color: '#ff22bb' },
              ],
            },
          ];
        })
      );
      request.project.cues[1].droneEdits![outside] = {
        position: [20, -10, 70],
        color: '#00ff88',
        keyframes: [{ time: 2, position: [22, -9, 72], brightness: 0.7 }],
      };
      const expected = structuredClone(request.project);
      // Independent exact +90° Up oracle: scaled [x,y,z] becomes [-3y,-2x,z/2]
      // relative to this pivot. No production transform/evaluator participates.
      const expectedPosition = ([x, y, z]: Vector3Tuple): Vector3Tuple => [
        14 - 3 * (y + 4),
        1 - 2 * (x - 10),
        28 + (z - 30) / 2,
      ];
      for (const id of [...request.selection, 311]) {
        const edit = expected.cues[1].droneEdits![id];
        edit.position = expectedPosition(edit.position!);
        for (const key of edit.keyframes!)
          if (key.position) key.position = expectedPosition(key.position);
      }
      const fields = {
        type: 'transform_drones' as const,
        cueId: request.cueId,
        pivot: [10, -4, 30] as Vector3Tuple,
        scale: [-2, 3, 0.5] as Vector3Tuple,
        rotation: { axis: [0, 0, 1] as Vector3Tuple, angleDegrees: 90 },
        translation: [4, 5, -2] as Vector3Tuple,
        scope: 'base_and_keys' as const,
      };
      return {
        request,
        expected,
        fullSelection: true,
        operations: [
          { ...fields, ids: [...request.selection] },
          { ...fields, ids: [311] },
        ],
      };
    },
  },
  {
    id: 'group-transform-at-playhead',
    title: 'Keyed group transform uses scene targets and preserves mixed light keys',
    prompt:
      'At the current SHOW-global playhead of 9 seconds, transform the selected drones 3 and 6 in Detail by writing only a position key. Detail starts at show second 7, so use local time 2. Transform each drone’s own evaluated SCENE TARGET before the incoming transition blend, not its rendered blended location. Use pivot [2,-3,20], first scale [0,-2,1], then rotate +90 degrees right-handed around Up [0,0,1], then translate [-1,5,3] after restoring the pivot. The zero East scale and negative North scale are intentional. Preserve every existing light channel and easing at local time 2, static properties, all other keys, unselected drones, Opening, and all scene/show settings.',
    fixture() {
      const request = baseRequest(2);
      request.selection = [3, 6];
      request.time = 9;
      request.project.cues[0].droneEdits = {
        3: { position: [100, 100, 100], color: '#112233' },
        6: { position: [-40, 80, 70], brightness: 0.4 },
      };
      request.project.cues[1].transitionEasing = 'linear';
      request.project.cues[1].droneEdits = {
        3: {
          position: [10, 20, 40],
          color: '#334455',
          brightness: 0.6,
          keyframes: [
            { time: 0, position: [2, 4, 30], easing: 'linear', brightness: 0.2 },
            {
              time: 2,
              color: '#ffaa11',
              brightness: 0.8,
              easing: 'hold',
              flash: { hz: 2, duty: 0.25, phase: 0.5 },
            },
            { time: 4, position: [10, 12, 46], color: '#112233' },
            { time: 8, brightness: 0.3 },
          ],
        },
        6: {
          position: [-6, 2, 45],
          color: '#667788',
          keyframes: [
            { time: 0, color: '#abcdef' },
            { time: 2, brightness: 0.55, easing: 'smooth' },
          ],
        },
        4: {
          position: [12, -8, 50],
          keyframes: [{ time: 2, position: [11, -7, 51], color: '#ff0088' }],
        },
      };
      const expected = structuredClone(request.project);
      // Drone 3's position-only interpolation at local2 is [6,8,38]; light-only
      // keys do not interrupt it. Drone 6's scene target is its static [-6,2,45].
      // At +90° Up, scaled [0,-2dy,dz] becomes [2dy,0,dz].
      expected.cues[1].droneEdits![3].keyframes![1].position = [23, 2, 41];
      expected.cues[1].droneEdits![6].keyframes![1].position = [11, 2, 48];
      return {
        request,
        expected,
        fullSelection: true,
        operations: [
          {
            type: 'transform_drones',
            cueId: request.cueId,
            ids: [...request.selection],
            pivot: [2, -3, 20],
            scale: [0, -2, 1],
            rotation: { axis: [0, 0, 1], angleDegrees: 90 },
            translation: [-1, 5, 3],
            scope: 'key_at_time',
            time: 2,
          },
        ],
      };
    },
  },
  {
    id: 'fleet-expansion',
    title: 'Fleet growth restores dormant authored work',
    prompt:
      'Increase the virtual fleet from 8 to 16. Keep ALL existing authored data in both scenes unchanged, including currently dormant drone 12. In Detail only, give drone 16 the static base color #77ccff. Preserve every other scene/show setting and do not create any other drone edits.',
    fixture() {
      const request = baseRequest(2);
      request.selection = [];
      request.project.cues[0].droneEdits = {
        12: { color: '#ffaa66', keyframes: [{ time: 2, position: [6, 8, 41] }] },
      };
      request.project.cues[1].droneEdits = {
        12: { position: [4, -6, 47], brightness: 0.7, keyframes: [{ time: 3, color: '#9988ff' }] },
        2: { color: '#fff111' },
      };
      const expected = structuredClone(request.project);
      expected.droneCount = 16;
      expected.cues[1].droneEdits![16] = { color: '#77ccff' };
      return {
        request,
        expected,
        operations: [
          { type: 'set_fleet', count: 16 },
          { type: 'edit_drones', cueId: request.cueId, ids: [16], patch: { color: '#77ccff' } },
        ],
      };
    },
  },
  audienceEvaluation,
  cameraEvaluation,
  targetingEvaluation,
];

export function listEvaluationCases(): { id: string; title: string; prompt: string }[] {
  return definitions.map(({ id, title, prompt }) => ({ id, title, prompt }));
}

/** Normalize semantic equivalents while preserving meaningful array/scene order and content. */
function canonical(value: unknown, key = ''): unknown {
  if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  if (Array.isArray(value)) {
    const items = key === 'keyframes' ? [...value].sort((a, b) => a.time - b.time) : value;
    return items.map((item) => canonical(item));
  }
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, item]) => [name, canonical(item, name)])
    );
  return value;
}
function equal(a: unknown, b: unknown) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
function firstDifference(actual: unknown, expected: unknown, path = 'project'): string | null {
  if (equal(actual, expected)) return null;
  if (actual && expected && typeof actual === 'object' && typeof expected === 'object') {
    const a = canonical(actual) as Record<string, unknown>,
      b = canonical(expected) as Record<string, unknown>;
    for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
      const nested = firstDifference(a[key], b[key], `${path}.${key}`);
      if (nested) return nested;
    }
  }
  return path;
}
function redact(value: unknown): unknown {
  if (typeof value === 'string')
    return value
      .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[redacted credential]')
      .replace(/\bBearer\s+[A-Za-z0-9_.~+\/-]{8,}/gi, 'Bearer [redacted credential]');
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /^(authorization|api[_-]?key|access[_-]?token|password|secret)$/i.test(key)
          ? '[redacted credential]'
          : redact(item),
      ])
    );
  return value;
}

export async function runEvaluationSuite(options: {
  providerFactory: (request: AgentRequest, caseId: string) => AgentProvider;
  caseIds?: string[];
  signal?: AbortSignal;
  onCase?: (result: EvaluationCaseResult) => void;
}): Promise<EvaluationReport> {
  const ids = options.caseIds ?? definitions.map((item) => item.id);
  if (!ids.length || ids.length > definitions.length || new Set(ids).size !== ids.length)
    throw new Error(`Select one to ${definitions.length} unique evaluation cases.`);
  const selected = ids.map((id) => {
    const definition = definitions.find((item) => item.id === id);
    if (!definition) throw new Error(`Unknown evaluation case: ${id}.`);
    return definition;
  });
  const started = Date.now();
  const cases: EvaluationCaseResult[] = [];
  for (const definition of selected) {
    if (options.signal?.aborted) break;
    const began = Date.now();
    const fixture = definition.fixture();
    fixture.request.prompt = definition.prompt;
    const before = structuredClone(fixture.request);
    const findings: EvaluationFinding[] = [];
    let run: EvaluationCaseResult['run'] = {
      runId: '',
      status: 'failed',
      message: 'The provider could not initialize.',
      events: [],
    };
    let usage: AgentUsage = { inputTokens: 0, outputTokens: 0 };
    let reviewed = false;
    try {
      const provider = options.providerFactory(fixture.request, definition.id);
      const result = await runAgent(fixture.request, {
        provider,
        signal: options.signal,
        limits: {
          maxTurns: 10,
          maxToolCalls: 24,
          maxOperations: 32,
          maxRuntimeMs: 45_000,
          maxContextChars: 240_000,
          maxResponseChars: 96_000,
        },
      });
      run = {
        runId: result.runId,
        status: result.status,
        message: result.message,
        events: result.events,
        ...(result.proposal ? { proposal: result.proposal } : {}),
      };
      usage = result.usage;
      reviewed = Boolean(result.review || result.reviewLimited);
    } catch {
      // Provider initialization errors can contain credentials or raw response payloads.
      // Keep the report safe and let the caller inspect its provider separately.
      if (options.signal?.aborted)
        run = { ...run, status: 'cancelled', message: 'Evaluation cancelled.' };
    }
    findings.push({
      name: 'Agent completed',
      passed: run.status === 'completed',
      detail: `Run status: ${run.status}.`,
    });
    const unchanged = JSON.stringify(fixture.request) === JSON.stringify(before);
    findings.push({
      name: 'Request fixture unchanged',
      passed: unchanged,
      detail: unchanged
        ? 'The owned request snapshot was preserved.'
        : 'The request was mutated during execution.',
    });
    const proposal = run.proposal;
    findings.push({
      name: 'Reviewable proposal',
      passed: Boolean(proposal && reviewed),
      detail:
        proposal && reviewed
          ? 'A proposal followed review of the latest draft.'
          : 'A reviewed proposal was not returned.',
    });
    const identityMatches = Boolean(
      proposal &&
        proposal.projectId === before.project.id &&
        proposal.revision === before.project.revision
    );
    findings.push({
      name: 'Original project and revision',
      passed: identityMatches,
      detail: identityMatches
        ? 'Proposal targets the original project revision.'
        : 'Missing proposal or incorrect project/revision.',
    });
    let applied: Project | undefined;
    if (proposal && identityMatches) {
      try {
        // Exactly one application, entirely in memory, against the independently owned baseline.
        applied = applyOperations(before.project, proposal.operations, proposal.revision);
      } catch {
        /* The finding below records an invalid atomic proposal without leaking payloads. */
      }
    }
    findings.push({
      name: 'Atomic application',
      passed: Boolean(applied && applied.revision === before.project.revision + 1),
      detail: applied
        ? 'Applied once to an isolated in-memory snapshot.'
        : 'The proposal could not be atomically applied.',
    });
    if (applied) {
      const expected = { ...fixture.expected, revision: before.project.revision + 1 };
      const difference = firstDifference(applied, expected);
      findings.push({
        name: 'Requested outcome and unrelated preservation',
        passed: difference === null,
        detail: difference
          ? `Unexpected or missing authored data at ${difference}.`
          : 'Every requested semantic change is present; unrelated authored content is preserved.',
      });
    } else
      findings.push({
        name: 'Requested outcome and unrelated preservation',
        passed: false,
        detail: 'No applied candidate was available for semantic comparison.',
      });
    let audienceEvidence: AudienceRefinementEvidence | undefined;
    if (definition.id === audienceEvaluation.id) {
      try {
        const measured = await evaluateAudienceRefinement(
          before,
          applied,
          run.events,
          options.signal
        );
        findings.push(...measured.findings);
        audienceEvidence = measured.evidence;
      } catch {
        if (options.signal?.aborted)
          run = {
            ...run,
            status: 'cancelled',
            message: 'Evaluation cancelled while checking audience evidence.',
          };
        findings.push({
          name: 'Audience composition evidence',
          passed: false,
          detail: options.signal?.aborted
            ? 'Audience evidence checking was cancelled.'
            : 'Audience evidence could not be verified.',
        });
      }
    }
    let cameraEvidence: CameraRefinementEvidence | undefined;
    if (definition.id === cameraEvaluation.id) {
      try {
        const measured = await evaluateCameraRefinement(
          before,
          applied,
          run.events,
          proposal?.operations.length ?? 0,
          options.signal
        );
        findings.push(...measured.findings);
        cameraEvidence = measured.evidence;
      } catch {
        if (options.signal?.aborted)
          run = {
            ...run,
            status: 'cancelled',
            message: 'Evaluation cancelled while checking camera evidence.',
          };
        findings.push({
          name: 'Camera composition evidence',
          passed: false,
          detail: options.signal?.aborted
            ? 'Camera evidence checking was cancelled.'
            : 'Camera evidence could not be verified.',
        });
      }
    }
    let targetingEvidence: AudienceTargetingEvidence | undefined;
    if (definition.id === targetingEvaluation.id) {
      try {
        const measured = await evaluateAudienceTargeting(
          before,
          applied,
          run.events,
          proposal?.operations.length ?? 0,
          options.signal
        );
        findings.push(...measured.findings);
        targetingEvidence = measured.evidence;
      } catch {
        if (options.signal?.aborted)
          run = {
            ...run,
            status: 'cancelled',
            message: 'Evaluation cancelled while checking complete audience targets.',
          };
        findings.push({
          name: 'Complete audience target evidence',
          passed: false,
          detail: options.signal?.aborted
            ? 'Target verification was cancelled.'
            : 'The complete audience target could not be verified.',
        });
      }
    }
    const caseResult: EvaluationCaseResult = redact({
      id: definition.id,
      title: definition.title,
      status:
        run.status === 'cancelled'
          ? 'cancelled'
          : findings.every((finding) => finding.passed)
            ? 'passed'
            : 'failed',
      durationMs: Date.now() - began,
      usage,
      context: {
        projectId: before.project.id,
        revision: before.project.revision,
        selectedCount: before.selection.length,
        droneCount: before.project.droneCount,
      },
      findings,
      ...(audienceEvidence ? { audienceEvidence } : {}),
      ...(cameraEvidence ? { cameraEvidence } : {}),
      ...(targetingEvidence ? { targetingEvidence } : {}),
      run,
    }) as EvaluationCaseResult;
    cases.push(caseResult);
    try {
      options.onCase?.(structuredClone(caseResult));
    } catch {
      /* Observers cannot change evaluation results. */
    }
    if (run.status === 'cancelled' || options.signal?.aborted) break;
  }
  const summary = {
    total: selected.length,
    passed: cases.filter((item) => item.status === 'passed').length,
    failed: cases.filter((item) => item.status === 'failed').length,
    cancelled: cases.filter((item) => item.status === 'cancelled').length,
    skipped: selected.length - cases.length,
  };
  return {
    version: 1,
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    status:
      options.signal?.aborted || summary.cancelled
        ? 'cancelled'
        : summary.failed
          ? 'failed'
          : 'passed',
    summary,
    usage: cases.reduce(
      (sum, item) => ({
        inputTokens: sum.inputTokens + item.usage.inputTokens,
        outputTokens: sum.outputTokens + item.usage.outputTokens,
      }),
      { inputTokens: 0, outputTokens: 0 }
    ),
    cases,
  };
}

/** Scripted harness fixtures verify the evaluator/plumbing; they do not measure model quality. */
export function createEvaluationFixtureProvider(
  request: AgentRequest,
  caseId: string
): AgentProvider {
  if (caseId === audienceEvaluation.id) return createAudienceEvaluationProvider(request);
  if (caseId === cameraEvaluation.id) return createCameraEvaluationProvider(request);
  if (caseId === targetingEvaluation.id) return createTargetingEvaluationProvider(request);
  const definition = definitions.find((item) => item.id === caseId);
  if (!definition) throw new Error(`Unknown evaluation case: ${caseId}.`);
  const fixture = definition.fixture();
  const firstOperation = fixture.operations[0];
  const steps: { name: string; args: object }[] = [
    { name: 'inspect_show', args: {} },
    {
      name: 'inspect_scene',
      args: { cueId: request.cueId, offset: 0, limit: 8, keyframeOffset: 0, keyframeLimit: 8 },
    },
    ...(request.selection.length > 128
      ? [{ name: 'inspect_selection', args: { offset: 128, limit: 128 } }]
      : []),
    { name: 'command_schema', args: { operationType: firstOperation.type } },
  ];
  if (fixture.fullSelection && 'ids' in firstOperation) {
    const { ids: _ids, ...operation } = firstOperation;
    steps.push({
      name: 'stage_selection_operation',
      args: {
        operationJson: JSON.stringify(operation),
        explanation:
          'Scripted evaluation fixture: apply the case-defined edit to the complete captured selection.',
      },
    });
    if (fixture.operations.length > 1)
      steps.push({
        name: 'stage_operations',
        args: {
          operationsJson: JSON.stringify(fixture.operations.slice(1)),
          explanation:
            'Scripted evaluation fixture: also apply the explicitly requested edits outside the captured selection.',
        },
      });
  } else
    steps.push({
      name: 'stage_operations',
      args: {
        operationsJson: JSON.stringify(fixture.operations),
        explanation: 'Scripted evaluation fixture: apply the case-defined commands.',
      },
    });
  steps.push(
    { name: 'review_draft', args: {} },
    {
      name: 'finish_proposal',
      args: {
        title: `Scripted fixture: ${definition.title}`,
        description:
          'Deterministic evaluation fixture using the real editor tool harness. This is not a model-quality result. Design review may have issues or incomplete checks; no flight readiness is claimed.',
        changes: [definition.title],
      },
    }
  );
  let index = 0;
  return {
    async complete() {
      const step = steps[index++];
      if (!step) return { output: [], calls: [], text: 'Scripted fixture ended.' };
      const call = {
        id: `fixture-${caseId}-${index}`,
        name: step.name,
        arguments: JSON.stringify(step.args),
      };
      return {
        output: [
          { type: 'function_call', call_id: call.id, name: call.name, arguments: call.arguments },
        ],
        calls: [call],
        text: '',
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  };
}
