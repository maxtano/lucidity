import { ShowEvaluator } from './animation';
export { lightIntensity } from './animation';
import { projectSchema, totalDuration, type Project } from './model';
import type { ValidationReport } from './validation';
import { STORYBOARD_BENCH_PULSE } from './bench-storyboard';

export function projectBundle(project: Project, report: ValidationReport | null) {
  const hasBenchCues = project.cues.some((cue) => cue.benchCue != null);
  return {
    format: 'lucidity.design',
    formatVersion: hasBenchCues ? 4 : 3,
    engineVersion: '0.4.0',
    exportedAt: new Date().toISOString(),
    intendedUse: hasBenchCues ? 'props-off-storyboard-rehearsal' : 'simulation-and-operator-handoff',
    ...(hasBenchCues ? {
      benchExecution: {
        intendedUse: 'props-off-only',
        pulse: { ...STORYBOARD_BENCH_PULSE },
        timing: 'scene-local-offset-seconds',
        note: 'Authored motor pulses require fresh local validation, aircraft assignment and physical checks. This file does not authorize hardware commands or flight.',
      },
    } : {}),
    flightReady: false,
    coordinateSystem: {
      frame: 'local-ENU',
      units: 'meters',
      axes: { x: 'east', y: 'north', z: 'up' },
      geodeticOrigin: null,
    },
    clock: { units: 'seconds', origin: 'relative-show-start', tempoBpm: project.bpm },
    interpolation: 'scene-local-keyframes-then-authored-incoming-blend',
    animation: {
      channels: ['position', 'color', 'brightness', 'flash'],
      keyTimes: 'scene-local-seconds',
      easing: ['linear', 'smooth', 'hold'],
      transitionEasing: ['smooth', 'linear', 'ease-in', 'ease-out'],
      defaultTransitionEasing: 'smooth',
    },
    identity: 'one-based-stable-point-index',
    project: projectSchema.parse(project),
    validation: report?.revision === project.revision ? report : null,
    media: {
      audioEmbedded: false,
      note: 'Supply the soundtrack separately. Audio remains local to the browser session.',
    },
    operatorWorkRequired: [
      'Collision-free drone assignment and transition planning',
      'Takeoff, landing, abort and contingency routes',
      'Site origin, geofence, hardware profile and positioning margins',
      'Independent continuous-time validation',
      'Hardware-specific compilation, simulation, clock checks and operator authorization',
    ],
  };
}
export function parseProjectFile(text: string): Project {
  if (text.length > 32_000_000) throw new Error('Project files must be smaller than 32 MB.');
  const raw: unknown = JSON.parse(text);
  if (raw && typeof raw === 'object' && 'format' in raw) {
    const bundle = raw as Record<string, unknown>;
    if (bundle.format !== 'lucidity.design' || ![1, 2, 3, 4].includes(Number(bundle.formatVersion)))
      throw new Error('Unsupported design format.');
    return projectSchema.parse(bundle.project);
  }
  return projectSchema.parse(raw);
}
export function trajectoryCsv(project: Project): string {
  projectSchema.parse(project);
  const duration = totalDuration(project),
    frames = Math.ceil(duration * 2) + 1;
  if (project.droneCount * frames > 350_000)
    throw new Error(
      'CSV preview is limited to 350,000 rows. Reduce the fleet or duration, or export the compact design bundle.'
    );
  const evaluator = new ShowEvaluator(project);
  const lines = [
    '# Lucidity simulation samples only; not a flight mission. 2 Hz maximum interval; local ENU meters; no geographic origin or takeoff/landing.',
    'time_s,drone_id,east_m,north_m,up_m,red,green,blue',
  ];
  for (let f = 0; f < frames; f++) {
    const t = Math.min(f / 2, duration),
      frame = evaluator.sample(t);
    for (let i = 0; i < project.droneCount; i++) {
      const p = i * 3;
      const point = [0, 1, 2].map((j) => frame.positions[p + j].toFixed(4));
      const rgb = [0, 1, 2].map((j) => Math.round(frame.shades[p + j] * 255));
      lines.push([t.toFixed(3), i + 1, ...point, ...rgb].join(','));
    }
  }
  return lines.join('\n');
}
