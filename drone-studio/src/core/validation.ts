import { formation, interpolate } from './formations';
import { transitionEase, transitionPeakSlope, type Project } from './model';
import { totalDuration } from './model';
import { ShowEvaluator } from './animation';

export type Check = { name: string; status: 'pass' | 'fail' | 'incomplete'; detail: string };
export type ValidationReport = {
  revision: number;
  checkedAt: string;
  scope: 'design-review';
  flightReady: false;
  status: 'issues' | 'incomplete' | 'sampled';
  checks: Check[];
  maxSpeed: number;
  maxAcceleration: number;
  minAltitude: number;
  maxAltitude: number;
  separationSamples: number;
  conflicts: { time: number; droneA: number; droneB: number; distance: number }[];
};

/** First conflict per sample, with a bounded spatial-hash search. No all-pairs loop. */
export function separationConflict(
  positions: Float32Array,
  threshold: number
): { a: number; b: number; distance: number } | null {
  const cells = new Map<string, number[]>();
  for (let i = 0; i < positions.length / 3; i++) {
    const x = positions[i * 3],
      y = positions[i * 3 + 1],
      z = positions[i * 3 + 2];
    const cx = Math.floor(x / threshold),
      cy = Math.floor(y / threshold),
      cz = Math.floor(z / threshold);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const neighbors = cells.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!neighbors) continue;
          for (const j of neighbors) {
            const distance = Math.hypot(
              x - positions[j * 3],
              y - positions[j * 3 + 1],
              z - positions[j * 3 + 2]
            );
            if (distance < threshold) return { a: j + 1, b: i + 1, distance };
          }
        }
    const key = `${cx},${cy},${cz}`;
    const cell = cells.get(key);
    if (cell) cell.push(i);
    else cells.set(key, [i]);
  }
  return null;
}

export function validateProject(project: Project): ValidationReport {
  if (
    project.cues.some((c) =>
      Object.values(c.droneEdits || {}).some((e) => e.keyframes?.some((k) => k.position))
    )
  )
    return validateAnimatedProject(project);
  const instantCuts = project.cues.slice(1).some((c) => c.transition === 0);
  const velocityCorners = project.cues
    .slice(1)
    .some((c) => c.transition > 0 && c.transitionEasing && c.transitionEasing !== 'smooth');
  let previous: Float32Array | undefined,
    maxSpeed = 0,
    maxAcceleration = 0,
    minAltitude = Infinity,
    maxAltitude = -Infinity,
    maxRadius = 0,
    time = 0,
    separationSamples = 0;
  const conflicts: ValidationReport['conflicts'] = [];
  const checkSeparation = project.droneCount <= 2000;
  for (const cue of project.cues) {
    const positions = formation(cue, project.droneCount);
    for (let i = 0; i < project.droneCount; i++) {
      minAltitude = Math.min(minAltitude, positions[i * 3 + 2]);
      maxAltitude = Math.max(maxAltitude, positions[i * 3 + 2]);
      maxRadius = Math.max(maxRadius, Math.hypot(positions[i * 3], positions[i * 3 + 1]));
      if (previous && cue.transition > 0) {
        const distance = Math.hypot(
          positions[i * 3] - previous[i * 3],
          positions[i * 3 + 1] - previous[i * 3 + 1],
          positions[i * 3 + 2] - previous[i * 3 + 2]
        );
        maxSpeed = Math.max(
          maxSpeed,
          (transitionPeakSlope[cue.transitionEasing || 'smooth'] * distance) / cue.transition
        );
        const accelerationFactor =
          !cue.transitionEasing || cue.transitionEasing === 'smooth'
            ? 10 / Math.sqrt(3)
            : cue.transitionEasing === 'linear'
              ? 0
              : 6;
        maxAcceleration = Math.max(
          maxAcceleration,
          (accelerationFactor * distance) / cue.transition ** 2
        );
      }
    }
    if (checkSeparation) {
      const steps = previous ? Math.ceil(cue.transition * 2) : 0;
      for (let step = 0; step <= steps; step++) {
        const fraction = steps ? step / steps : 1;
        const sample = previous
          ? interpolate(previous, positions, transitionEase(fraction, cue.transitionEasing))
          : positions;
        separationSamples++;
        const conflict = separationConflict(sample, project.limits.minimumSeparation);
        if (conflict && conflicts.length < 16)
          conflicts.push({
            time: time + fraction * (previous ? cue.transition : 0),
            droneA: conflict.a,
            droneB: conflict.b,
            distance: conflict.distance,
          });
      }
    }
    previous = positions;
    time += cue.duration;
  }
  const checks: Check[] = [
    {
      name: 'Stage volume',
      status:
        minAltitude >= 0 &&
        maxAltitude <= project.limits.maxAltitude &&
        maxRadius <= project.limits.radius
          ? 'pass'
          : 'fail',
      detail: `${minAltitude.toFixed(1)}–${maxAltitude.toFixed(1)} m altitude · ${maxRadius.toFixed(1)} m radius. Limits: ${project.limits.maxAltitude} m / ${project.limits.radius} m.`,
    },
    {
      name: 'Peak speed',
      status: maxSpeed > project.limits.maxSpeed ? 'fail' : instantCuts ? 'incomplete' : 'pass',
      detail: `${maxSpeed.toFixed(2)} m/s · limit ${project.limits.maxSpeed} m/s. Analytic peak inside straight transitions using the authored blend profile.${instantCuts ? ' Instant cuts are discontinuous and excluded from this finite value.' : ''}`,
    },
    {
      name: 'Peak acceleration',
      status:
        maxAcceleration > project.limits.maxAcceleration
          ? 'fail'
          : velocityCorners || instantCuts
            ? 'incomplete'
            : 'pass',
      detail: `${maxAcceleration.toFixed(2)} m/s² · limit ${project.limits.maxAcceleration} m/s². Analytic interior value.${velocityCorners || instantCuts ? ' Endpoint velocity jumps and instant cuts have no finite acceleration bound.' : ' Smooth transitions have zero endpoint velocity and acceleration.'}`,
    },
    {
      name: 'Drone separation',
      status: !checkSeparation ? 'incomplete' : conflicts.length ? 'fail' : 'pass',
      detail: !checkSeparation
        ? 'Separation review is limited to 2,000 drones. Larger fleets are visual previews only.'
        : conflicts.length
          ? `Conflicts below ${project.limits.minimumSeparation} m found. ${separationSamples} samples reviewed; up to 16 examples retained.`
          : `No conflicts below ${project.limits.minimumSeparation} m in ${separationSamples} samples, at intervals of at most 0.5 s. Between-sample collisions remain possible.`,
    },
    {
      name: 'Flight lifecycle',
      status: 'incomplete',
      detail:
        'Takeoff, landing, drone assignment, downwash, positioning uncertainty, and contingency routes need an operator planner.',
    },
  ];
  if (instantCuts)
    checks.push({
      name: 'Instant scene cuts',
      status: 'incomplete',
      detail:
        'Zero-duration transitions are creative cuts. Motion bounds do not cover their discontinuities.',
    });
  return {
    revision: project.revision,
    checkedAt: new Date().toISOString(),
    scope: 'design-review',
    flightReady: false,
    status: checks.some((c) => c.status === 'fail') ? 'issues' : 'incomplete',
    checks,
    maxSpeed,
    maxAcceleration,
    minAltitude,
    maxAltitude,
    separationSamples,
    conflicts,
  };
}

function validateAnimatedProject(project: Project): ValidationReport {
  const evaluator = new ShowEvaluator(project),
    duration = totalDuration(project);
  const supported = project.droneCount <= 2000;
  const steps = supported ? Math.ceil(duration * 2) : 16;
  let minAltitude = Infinity,
    maxAltitude = -Infinity,
    maxRadius = 0,
    maxSpeed = 0,
    maxAcceleration = 0;
  let previous: Float32Array | null = null,
    previousVelocity: Float32Array | null = null;
  const conflicts: ValidationReport['conflicts'] = [];
  const dt = duration / steps;
  for (let step = 0; step <= steps; step++) {
    const time = step * dt,
      positions = evaluator.sample(time).positions;
    const velocity = new Float32Array(positions.length);
    for (let i = 0; i < positions.length; i += 3) {
      minAltitude = Math.min(minAltitude, positions[i + 2]);
      maxAltitude = Math.max(maxAltitude, positions[i + 2]);
      maxRadius = Math.max(maxRadius, Math.hypot(positions[i], positions[i + 1]));
      if (previous) {
        for (let j = 0; j < 3; j++) velocity[i + j] = (positions[i + j] - previous[i + j]) / dt;
        maxSpeed = Math.max(maxSpeed, Math.hypot(velocity[i], velocity[i + 1], velocity[i + 2]));
        if (previousVelocity)
          maxAcceleration = Math.max(
            maxAcceleration,
            Math.hypot(...[0, 1, 2].map((j) => (velocity[i + j] - previousVelocity![i + j]) / dt))
          );
      }
    }
    if (supported) {
      const conflict = separationConflict(positions, project.limits.minimumSeparation);
      if (conflict && conflicts.length < 16)
        conflicts.push({
          time,
          droneA: conflict.a,
          droneB: conflict.b,
          distance: conflict.distance,
        });
    }
    previous = positions;
    if (step > 0) previousVelocity = velocity;
  }
  const sampling = supported
    ? `${steps + 1} samples, at intervals ≤0.5 s`
    : '17 sparse samples; fleet exceeds detailed review capacity';
  const checks: Check[] = [
    {
      name: 'Stage volume',
      status:
        minAltitude < 0 ||
        maxAltitude > project.limits.maxAltitude ||
        maxRadius > project.limits.radius
          ? 'fail'
          : 'incomplete',
      detail: `${minAltitude.toFixed(1)}–${maxAltitude.toFixed(1)} m altitude · ${maxRadius.toFixed(1)} m radius. Animated values sampled; between-sample extrema are unverified.`,
    },
    {
      name: 'Peak speed',
      status: maxSpeed > project.limits.maxSpeed ? 'fail' : 'incomplete',
      detail: `${maxSpeed.toFixed(2)} m/s observed from samples. Keyframed motion has no continuous bound in this release.`,
    },
    {
      name: 'Peak acceleration',
      status: maxAcceleration > project.limits.maxAcceleration ? 'fail' : 'incomplete',
      detail: `${maxAcceleration.toFixed(2)} m/s² observed from samples. Hold keys and cuts can be discontinuous.`,
    },
    {
      name: 'Drone separation',
      status: conflicts.length ? 'fail' : 'incomplete',
      detail: supported
        ? `${sampling}; ${conflicts.length} conflict examples retained. Between-sample collisions remain possible.`
        : 'Separation review is limited to 2,000 drones.',
    },
    {
      name: 'Custom animation',
      status: 'incomplete',
      detail: `${sampling}. Position keys, incoming blends, and flashing are evaluated by the same engine as the viewer and export.`,
    },
    {
      name: 'Flight lifecycle',
      status: 'incomplete',
      detail:
        'Creative animation requires continuous trajectory planning and an operator mission compiler before flight.',
    },
  ];
  return {
    revision: project.revision,
    checkedAt: new Date().toISOString(),
    scope: 'design-review',
    flightReady: false,
    status: checks.some((c) => c.status === 'fail') ? 'issues' : 'incomplete',
    checks,
    maxSpeed,
    maxAcceleration,
    minAltitude,
    maxAltitude,
    separationSamples: supported ? steps + 1 : 0,
    conflicts,
  };
}
