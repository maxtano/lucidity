import { describe, expect, it } from 'vitest';
import { MavLinkProtocolV2, ardupilotmega, minimal } from 'node-mavlink';
import { AircraftDecoder } from './decoder';

const frame = (message: minimal.Heartbeat | ardupilotmega.EkfStatusReport, system = 1, component = 1) =>
  new MavLinkProtocolV2(system, component).serialize(message, 0);

const heartbeat = () => Object.assign(new minimal.Heartbeat(), {
  autopilot: 3, type: 2, baseMode: 0, customMode: 0, systemStatus: 3, mavlinkVersion: 3,
});

const ekf = (flags: number) => Object.assign(new ardupilotmega.EkfStatusReport(), { flags });

describe('source-bound ArduPilot EKF status', () => {
  it('requires a vehicle heartbeat and matching autopilot component before attaching report', () => {
    const decoder = new AircraftDecoder('radio');
    decoder.push(frame(ekf(16 | 4 | 32)), 1);
    decoder.push(frame(Object.assign(heartbeat(), { autopilot: 8, type: 30 }), 255, 190), 2);
    expect(decoder.snapshot().aircraft).toEqual([]);

    decoder.push(frame(heartbeat(), 1, 1), 3);
    decoder.push(frame(heartbeat(), 2, 1), 3);
    decoder.push(frame(ekf(512 | 4 | 32), 1, 200), 4);
    decoder.push(frame(ekf(16 | 4 | 32), 2, 1), 5);
    expect(decoder.snapshot().aircraft.find(item => item.id === 'radio:1:1')?.ekfStatus).toBeUndefined();
    expect(decoder.snapshot().aircraft.find(item => item.id === 'radio:2:1')?.ekfStatus)
      .toEqual({ receivedAt: 5, flags: 16 | 4 | 32 });
  });

  it('preserves the newest report, including bad flags, without promoting an old good report', () => {
    const decoder = new AircraftDecoder('usb');
    decoder.push(frame(heartbeat()), 1);
    decoder.push(frame(ekf(16 | 4 | 32)), 100);
    decoder.push(frame(ekf(512 | 128 | 1024 | 32768)), 200);
    decoder.push(frame(ekf(16 | 4 | 32)), 150);
    expect(decoder.snapshot().aircraft[0].ekfStatus)
      .toEqual({ receivedAt: 200, flags: 512 | 128 | 1024 | 32768 });
  });
});
