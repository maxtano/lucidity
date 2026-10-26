import { expect, it } from 'vitest';
import { MavLinkProtocolV2, common, x25crc } from 'node-mavlink';
import { radioRequestFrame, telemetryRequestFrames } from './read-requests';

it('requests only a bounded RC_CHANNELS stream for radio setup', () => {
  const frame = radioRequestFrame(1, 1, 8);
  const protocol = new MavLinkProtocolV2();
  expect(protocol.crc(frame)).toBe(x25crc(frame, 1, 2, common.CommandLong.MAGIC_NUMBER));
  const command = protocol.data(protocol.payload(frame), common.CommandLong);
  expect([command.command, command._param1, command._param2]).toEqual([511, 65, 200000]);
  expect(command).toMatchObject({ targetSystem: 1, targetComponent: 1,
    _param3: 0, _param4: 0, _param5: 0, _param6: 0, _param7: 0 });
  for (const id of [0, 254, 256]) expect(() => radioRequestFrame(id, 1)).toThrow();
});

it('allows only fixed targeted reporting rates and one version request, never arming/mode/mission writes', () => {
  const protocol = new MavLinkProtocolV2();
  const frames = telemetryRequestFrames(7, 1, 254);
  expect(frames).toHaveLength(10);
  const decoded = frames.map((frame) => {
    const h = protocol.header(frame);
    expect(h).toMatchObject({ sysid: 254, compid: 190, msgid: 76, magic: 253 });
    expect(protocol.crc(frame)).toBe(x25crc(frame, 1, 2, common.CommandLong.MAGIC_NUMBER));
    const d = protocol.data(protocol.payload(frame), common.CommandLong);
    expect(d).toMatchObject({
      targetSystem: 7,
      targetComponent: 1,
      confirmation: 0,
      _param3: 0,
      _param4: 0,
      _param5: 0,
      _param6: 0,
      _param7: 0,
    });
    return [d.command, d._param1, d._param2];
  });
  expect(decoded).toEqual([
    [511, 30, 200000],
    [511, 33, 500000],
    [511, 24, 1000000],
    [511, 1, 1000000],
    [511, 147, 1000000],
    [511, 65, 200000],
    [511, 193, 500000],
    [511, 245, 500000],
    [511, 42, 500000],
    [512, 148, 0],
  ]);
  expect(frames.map((f) => protocol.header(f).seq)).toEqual([254, 255, 0, 1, 2, 3, 4, 5, 6, 7]);
  expect(decoded.map(([, id]) => id)).not.toContain(242); // HOME_POSITION is one-shot.
  expect(decoded.map(([, id]) => id)).not.toContain(46); // MISSION_ITEM_REACHED is event-driven.
});
it('refuses invalid or conflicting targets', () => {
  for (const id of [0, -1, 1.5, 256, NaN, 254])
    expect(() => telemetryRequestFrames(id, 1)).toThrow();
  expect(() => telemetryRequestFrames(1, 0)).toThrow();
});

it('diagnostics contain only targeted pre-arm checks and temporary input/power streams', async () => {
  const { diagnosticFrames } = await import('./read-requests');
  const protocol = new MavLinkProtocolV2();
  const frames = diagnosticFrames(1, 1, 255);
  expect(frames.map(f => protocol.header(f).seq)).toEqual([255, 0, 1]);
  expect(frames.map(f => {
    expect(protocol.crc(f)).toBe(x25crc(f, 1, 2, common.CommandLong.MAGIC_NUMBER));
    const d = protocol.data(protocol.payload(f), common.CommandLong);
    expect(d.targetSystem).toBe(1); expect(d.targetComponent).toBe(1);
    return [d.command, d._param1, d._param2];
  })).toEqual([[401, 0, 0], [511, 65, 1000000], [511, 125, 1000000]]);
  for (const id of [0, 254, 256, -1, NaN]) expect(() => diagnosticFrames(id, 1)).toThrow();
});
