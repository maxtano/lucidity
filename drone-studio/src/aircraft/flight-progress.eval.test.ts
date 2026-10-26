import { describe, expect, it } from 'vitest';
import type { AircraftTelemetry } from './types';
import { beginFlightProgress, observeFlightProgress, type FlightProgressSample } from './flight-progress';

const AIRCRAFT_ID = 'test-link:1:1';
const START = 1000;

function aircraft(at: number, options: {
  armed?: boolean;
  mode?: string;
  current?: number;
  reached?: number;
  landedState?: number;
  altitude?: number;
  total?: number;
  id?: string;
} = {}): AircraftTelemetry {
  return {
    id: options.id ?? AIRCRAFT_ID, systemId: 1, componentId: 1,
    protocolVersion: 2, signing: 'unsigned',
    heartbeat: {
      receivedAt: at, armed: options.armed ?? false, mode: options.mode ?? 'Stabilize',
      customMode: 0, systemStatus: 'Active', autopilot: 3, vehicleType: 2,
    },
    attitude: null, gps: null, battery: null, messages: [],
    position: {
      receivedAt: at, latitude: 47.397742, longitude: 8.545594,
      relativeAltitudeM: options.altitude ?? 0, altitudeMslM: 488,
      groundSpeedMps: 0,
    },
    ...(options.current === undefined ? {} : { missionCurrent: {
      receivedAt: at, seq: options.current, total: options.total ?? 4,
      state: 3, mode: 1, missionId: 0,
    } }),
    ...(options.reached === undefined ? {} : { missionItemReached: { receivedAt: at, seq: options.reached } }),
    ...(options.landedState === undefined ? {} : { extendedState: {
      receivedAt: at, landedState: options.landedState, vtolState: 0,
    } }),
  };
}

function sample(now: number, plane: AircraftTelemetry | null, overrides: Partial<FlightProgressSample> = {}): FlightProgressSample {
  return { now, linkGeneration: 7, linkState: 'listening', aircraft: plane, ...overrides };
}

describe('pure one-drone flight progress observation; no commands or physical output', () => {
  it('accepts Copter 4.7.1 MISSION_CURRENT.total=3 for HOME plus three executable items', () => {
    const started = beginFlightProgress(AIRCRAFT_ID, 7, START);
    const active = observeFlightProgress(started, sample(2000, aircraft(2000, {
      armed: true, mode: 'Auto', current: 1, total: 3, landedState: 2, altitude: 1,
    })));
    expect(active).toMatchObject({ state: 'active', maxMissionSeq: 1 });
  });

  it('observes pending, AUTO active, and landed without requiring final LAND reached', () => {
    let state = beginFlightProgress(AIRCRAFT_ID, 7, START);
    state = observeFlightProgress(state, sample(START, aircraft(START)));
    expect(state.state).toBe('pending');
    state = observeFlightProgress(state, sample(2000, aircraft(2000, {
      armed: true, mode: 'Auto', current: 1, landedState: 2, altitude: 0.8,
    })));
    expect(state).toMatchObject({ state: 'active', maxMissionSeq: 1, airborneAt: 2000 });
    state = observeFlightProgress(state, sample(8000, aircraft(8000, {
      armed: true, mode: 'Auto', current: 2, reached: 1, landedState: 2, altitude: 2,
    })));
    state = observeFlightProgress(state, sample(13000, aircraft(13000, {
      armed: true, mode: 'Auto', current: 3, reached: 2, landedState: 2, altitude: 0.9,
    })));
    state = observeFlightProgress(state, sample(18000, aircraft(18000, {
      armed: false, mode: 'Auto', current: 3, reached: 2, landedState: 1, altitude: 0.06,
    })));
    expect(state).toMatchObject({ state: 'landed', maxMissionSeq: 3, maxReachedSeq: 2 });
    // A later observation cannot silently resume or rewrite a completed run.
    expect(observeFlightProgress(state, sample(19000, null))).toBe(state);
  });

  it('waits for a fresh disarmed heartbeat after Copter resets the final LAND mission near ground', () => {
    let state = beginFlightProgress(AIRCRAFT_ID, 7, START);
    state = observeFlightProgress(state, sample(2000, aircraft(2000, {
      armed: true, mode: 'Auto', current: 1, landedState: 2, altitude: 1,
    })));
    state = observeFlightProgress(state, sample(8000, aircraft(8000, {
      armed: true, mode: 'Auto', current: 2, reached: 1, landedState: 2, altitude: 2,
    })));
    state = observeFlightProgress(state, sample(13000, aircraft(13000, {
      armed: true, mode: 'Auto', current: 3, reached: 2, landedState: 4, altitude: 0.9,
    })));
    state = observeFlightProgress(state, sample(17000, aircraft(17000, {
      armed: true, mode: 'Auto', current: 3, reached: 2, landedState: 1, altitude: 0.02,
    })));
    const reset = aircraft(17500, {
      armed: true, mode: 'Auto', current: 1, reached: 2, landedState: 1, altitude: 0.02,
    });
    reset.heartbeat.receivedAt = 17000; // the disarm heartbeat has not arrived yet
    state = observeFlightProgress(state, sample(17500, reset));
    expect(state).toMatchObject({ state: 'active', maxMissionSeq: 3, missionResetAt: 17500 });
    expect(state.reason).toMatch(/awaiting.*disarmed heartbeat/i);
    const disarmed = aircraft(18000, {
      armed: false, mode: 'Auto', current: 1, reached: 2, landedState: 1, altitude: 0.02,
    });
    disarmed.missionCurrent!.receivedAt = 17500;
    state = observeFlightProgress(state, sample(18000, disarmed));
    expect(state).toMatchObject({ state: 'landed', maxMissionSeq: 3, missionResetAt: 17500 });
  });

  it('still rejects an airborne sequence reset and an armed heartbeat newer than a near-ground reset', () => {
    const active = observeFlightProgress(beginFlightProgress(AIRCRAFT_ID, 7, START),
      sample(2000, aircraft(2000, { armed: true, mode: 'Auto', current: 1, landedState: 2, altitude: 1 })));
    const landing = observeFlightProgress(active, sample(13000, aircraft(13000, {
      armed: true, mode: 'Auto', current: 3, reached: 2, landedState: 4, altitude: 1,
    })));
    const airborneReset = aircraft(13500, {
      armed: true, mode: 'Auto', current: 1, reached: 2, landedState: 4, altitude: 1,
    });
    airborneReset.heartbeat.receivedAt = 13000;
    expect(observeFlightProgress(landing, sample(13500, airborneReset)).state).toBe('uncertain');

    const nearGround = observeFlightProgress(landing, sample(17000, aircraft(17000, {
      armed: true, mode: 'Auto', current: 3, reached: 2, landedState: 1, altitude: 0.02,
    })));
    const reset = aircraft(17500, {
      armed: true, mode: 'Auto', current: 1, reached: 2, landedState: 1, altitude: 0.02,
    });
    reset.heartbeat.receivedAt = 17000;
    const awaitingDisarm = observeFlightProgress(nearGround, sample(17500, reset));
    expect(awaitingDisarm.state).toBe('active');
    const stillArmed = aircraft(18000, {
      armed: true, mode: 'Auto', current: 1, reached: 2, landedState: 1, altitude: 0.02,
    });
    stillArmed.missionCurrent!.receivedAt = 17500;
    expect(observeFlightProgress(awaitingDisarm, sample(18000, stillArmed)).state).toBe('uncertain');
  });

  it('reports pilot-mode takeover without claiming autonomous completion', () => {
    let state = beginFlightProgress(AIRCRAFT_ID, 7, START);
    state = observeFlightProgress(state, sample(2000, aircraft(2000, {
      armed: true, mode: 'Auto', current: 1, landedState: 2, altitude: 1,
    })));
    state = observeFlightProgress(state, sample(3000, aircraft(3000, {
      armed: true, mode: 'Loiter', current: 1, landedState: 2, altitude: 1.2,
    })));
    expect(state).toMatchObject({ state: 'takeover' });
    expect(state.reason).toMatch(/independently/i);
    state = observeFlightProgress(state, sample(4000, aircraft(4000, {
      armed: true, mode: 'Loiter', current: 1, landedState: 2, altitude: 1.1,
    })));
    expect(state.state).toBe('takeover');
    state = observeFlightProgress(state, sample(5000, aircraft(5000, {
      armed: false, mode: 'Loiter', landedState: 1, altitude: 0,
    })));
    expect(state.state).toBe('uncertain');
  });

  it('does not mistake a non-AUTO disarm for completed LAND after a missed mode switch', () => {
    let state = beginFlightProgress(AIRCRAFT_ID, 7, START);
    state = observeFlightProgress(state, sample(2000, aircraft(2000, {
      armed: true, mode: 'Auto', current: 1, landedState: 2, altitude: 1,
    })));
    state = observeFlightProgress(state, sample(13000, aircraft(13000, {
      armed: true, mode: 'Auto', current: 3, reached: 2, landedState: 2, altitude: 1,
    })));
    state = observeFlightProgress(state, sample(18000, aircraft(18000, {
      armed: false, mode: 'Loiter', current: 3, reached: 2, landedState: 1, altitude: 0,
    })));
    expect(state.state).toBe('uncertain');
    expect(state.reason).toMatch(/outside AUTO/i);
  });

  it('fails closed on link loss and does not resume after a new link generation', () => {
    let state = beginFlightProgress(AIRCRAFT_ID, 7, START);
    state = observeFlightProgress(state, sample(2000, aircraft(2000, {
      armed: true, mode: 'Auto', current: 1, landedState: 2, altitude: 1,
    })));
    state = observeFlightProgress(state, sample(2500, null, { linkState: 'disconnected' }));
    expect(state).toMatchObject({ state: 'uncertain', linkGeneration: 7 });
    expect(state.reason).toMatch(/link.*lost/i);
    expect(observeFlightProgress(state, sample(3000, aircraft(3000, {
      armed: true, mode: 'Auto', current: 2, landedState: 2, altitude: 2,
    }), { linkGeneration: 8 }))).toBe(state);
  });

  it('does not call a disarmed drone landed without fresh landed-state evidence', () => {
    let state = beginFlightProgress(AIRCRAFT_ID, 7, START);
    state = observeFlightProgress(state, sample(2000, aircraft(2000, {
      armed: true, mode: 'Auto', current: 1, landedState: 2, altitude: 1,
    })));
    state = observeFlightProgress(state, sample(12000, aircraft(12000, {
      armed: true, mode: 'Auto', current: 3, reached: 2, landedState: 2, altitude: 1,
    })));
    state = observeFlightProgress(state, sample(18000, aircraft(18000, {
      armed: false, mode: 'Auto', current: 3, reached: 2, altitude: 0,
    })));
    expect(state.state).toBe('active'); // bounded wait for state message
    state = observeFlightProgress(state, sample(23001, aircraft(23001, {
      armed: false, mode: 'Auto', current: 3, reached: 2, altitude: 0,
    })));
    expect(state.state).toBe('uncertain');
    expect(state.reason).toMatch(/landed-state evidence/i);
  });

  it('requires LAND as the current item and prior LOITER completion, but not LAND reached', () => {
    let state = beginFlightProgress(AIRCRAFT_ID, 7, START);
    state = observeFlightProgress(state, sample(2000, aircraft(2000, {
      armed: true, mode: 'Auto', current: 1, landedState: 2, altitude: 1,
    })));
    state = observeFlightProgress(state, sample(12000, aircraft(12000, {
      armed: true, mode: 'Auto', current: 2, reached: 1, landedState: 2, altitude: 2,
    })));
    state = observeFlightProgress(state, sample(18000, aircraft(18000, {
      armed: false, mode: 'Auto', current: 2, reached: 1, landedState: 1, altitude: 0,
    })));
    expect(state.state).toBe('active');
    state = observeFlightProgress(state, sample(23001, aircraft(23001, {
      armed: false, mode: 'Auto', current: 2, reached: 1, landedState: 1, altitude: 0,
    })));
    expect(state.state).toBe('uncertain');
  });

  it('times out a repeated current item even while telemetry packets keep arriving', () => {
    let state = beginFlightProgress(AIRCRAFT_ID, 7, START);
    state = observeFlightProgress(state, sample(2000, aircraft(2000, {
      armed: true, mode: 'Auto', current: 1, landedState: 2, altitude: 1,
    })));
    state = observeFlightProgress(state, sample(18000, aircraft(18000, {
      armed: true, mode: 'Auto', current: 1, landedState: 2, altitude: 1,
    })));
    expect(state.state).toBe('active');
    state = observeFlightProgress(state, sample(32001, aircraft(32001, {
      armed: true, mode: 'Auto', current: 1, landedState: 2, altitude: 1,
    })));
    expect(state.state).toBe('uncertain');
    expect(state.reason).toMatch(/sequence stopped advancing/i);
  });

  it('rejects stale source telemetry, mission mismatch, and bounded start timeout', () => {
    const started = beginFlightProgress(AIRCRAFT_ID, 7, START);
    expect(observeFlightProgress(started, sample(5000, aircraft(1000))).state).toBe('uncertain');
    expect(observeFlightProgress(started, sample(2000, aircraft(2000, { id: 'other:1:1' }))).state).toBe('uncertain');
    expect(observeFlightProgress(started, sample(2000, aircraft(2000, {
      armed: true, mode: 'Auto', current: 1, total: 9, landedState: 2, altitude: 1,
    }))).state).toBe('uncertain');
    expect(observeFlightProgress(started, sample(17001, aircraft(17001))).state).toBe('uncertain');
  });
});
