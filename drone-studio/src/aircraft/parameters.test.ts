import { describe, expect, it } from 'vitest';
import { MavLinkProtocolV2, common, minimal } from 'node-mavlink';
import { AircraftDecoder } from './decoder';
import { parameterFrame, summarizeParameters, validateParameterValue } from './parameters';
const protocol = new MavLinkProtocolV2(1, 1);
function heartbeat() {
  const h = new minimal.Heartbeat();
  h.type = 2;
  h.autopilot = 3;
  return protocol.serialize(h, 0);
}
function param(name: string, value: number, index = 0, count = 1) {
  const p = new common.ParamValue();
  p.paramId = name;
  p.paramValue = value;
  p.paramType = 6;
  p.paramIndex = index;
  p.paramCount = count;
  return protocol.serialize(p, 0);
}
describe('ArduPilot parameter exchange', () => {
  it('decodes real parameter packets only after a vehicle heartbeat, with per-message revisions', () => {
    const decoder = new AircraftDecoder('test');
    decoder.push(param('FRAME_TYPE', 12), 100);
    expect(decoder.parameterSnapshot('test:1:1')).toEqual([]);
    decoder.push(heartbeat(), 100);
    decoder.push(param('FRAME_TYPE', 12), 101);
    decoder.push(param('FRAME_TYPE', 12), 101);
    expect(decoder.parameterSnapshot('test:1:1')[0]).toMatchObject({
      name: 'FRAME_TYPE',
      value: 12,
      type: 6,
      revision: 2,
    });
    const copy = decoder.parameterSnapshot('test:1:1');
    copy[0].value = 99;
    expect(decoder.parameterSnapshot('test:1:1')[0].value).toBe(12);
    decoder.resetParameters('test:1:1');
    expect(decoder.parameterSnapshot('test:1:1')).toEqual([]);
  });
  it('rejects invalid identifiers and corrupt/nonfinite values', () => {
    const decoder = new AircraftDecoder('test');
    decoder.push(heartbeat(), 100);
    decoder.push(param('../bad', 3), 101);
    decoder.push(param('FRAME_TYPE', NaN), 101);
    const corrupt = param('FRAME_TYPE', 1);
    corrupt[corrupt.length - 1] ^= 255;
    decoder.push(corrupt, 102);
    expect(decoder.parameterSnapshot('test:1:1')).toEqual([]);
  });
  it('encodes target-specific list, named read and typed set messages', () => {
    const read = parameterFrame(1, 1, 12, 'read', 'FRAME_TYPE');
    expect(protocol.header(read).msgid).toBe(common.ParamRequestRead.MSG_ID);
    expect(protocol.data(protocol.payload(read), common.ParamRequestRead)).toMatchObject({
      targetSystem: 1,
      targetComponent: 1,
      paramId: 'FRAME_TYPE',
      paramIndex: -1,
    });
    const set = parameterFrame(1, 1, 13, 'set', 'FRAME_TYPE', 12, 6);
    expect(protocol.data(protocol.payload(set), common.ParamSet)).toMatchObject({
      paramId: 'FRAME_TYPE',
      paramType: 6,
      paramValue: 12,
    });
    expect(protocol.header(parameterFrame(1, 1, 1, 'list')).msgid).toBe(
      common.ParamRequestList.MSG_ID
    );
    expect(() => parameterFrame(254, 1, 0, 'list')).toThrow();
    expect(() => parameterFrame(1, 1, 0, 'read', 'x;bad')).toThrow();
  });
  it('requires a complete, unique index set for the current parameter count', () => {
    const decoder = new AircraftDecoder('test');
    decoder.push(heartbeat(), 100);
    decoder.push(param('A', 1, 0, 2), 101);
    let values = decoder.parameterSnapshot('test:1:1');
    expect(summarizeParameters('test:1:1', values, 100, 102).state).toBe('reading');
    expect(summarizeParameters('test:1:1', values, 100, 30101).state).toBe('partial');
    decoder.push(param('B', 2, 1, 2), 103);
    values = decoder.parameterSnapshot('test:1:1');
    expect(summarizeParameters('test:1:1', values, 100, 104).state).toBe('complete');
    decoder.push(param('C', 3, 2, 4), 105);
    expect(
      summarizeParameters('test:1:1', decoder.parameterSnapshot('test:1:1'), 100, 106).state
    ).toBe('reading');
  });
  it.each([
    [6, 1.5],
    [6, 16777217],
    [2, 128],
    [4, 32768],
    [9, Infinity],
    [1, 42],
  ])('rejects unrepresentable or unsupported type %s value %s', (type, value) =>
    expect(() => validateParameterValue(type, value)).toThrow()
  );
  it('normalizes real32 and preserves supported integer values', () => {
    expect(validateParameterValue(9, 0.1)).toBe(Math.fround(0.1));
    expect(validateParameterValue(6, 12)).toBe(12);
  });
});
