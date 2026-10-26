import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MavLinkProtocolV2, common, minimal } from 'node-mavlink';
import { AircraftService, type AircraftSerialPort } from './service';
const wire = new MavLinkProtocolV2(1, 1),
  path = '/dev/cu.usbmodemTEST';
class Port extends EventEmitter {
  isOpen = false;
  open(cb: (error: Error | null) => void) {
    this.isOpen = true;
    cb(null);
  }
  close(cb: (error: Error | null) => void) {
    this.isOpen = false;
    this.emit('close');
    cb(null);
  }
  value = 12;
  rejectWrite = false;
  silent = false;
  write = vi.fn((buffer: Buffer, cb: (error: Error | null) => void) => {
    cb(null);
    const id = wire.header(buffer).msgid;
    if (this.silent) return true;
    if (id === common.ParamSet.MSG_ID && !this.rejectWrite)
      this.value = wire.data(wire.payload(buffer), common.ParamSet).paramValue;
    if (
      [
        common.ParamRequestRead.MSG_ID,
        common.ParamRequestList.MSG_ID,
        common.ParamSet.MSG_ID,
      ].includes(id)
    ) {
      const p = new common.ParamValue();
      p.paramId = 'FRAME_TYPE';
      p.paramValue = this.value;
      p.paramType = 6;
      p.paramIndex = 0;
      p.paramCount = 1;
      this.emit('data', wire.serialize(p, 0));
    }
    return true;
  });
  heartbeat(armed = false) {
    const h = new minimal.Heartbeat();
    h.type = 2;
    h.autopilot = 3;
    h.baseMode = (armed ? 128 : 0) as minimal.MavModeFlag;
    this.emit('data', wire.serialize(h, 0));
  }
}
const services: AircraftService[] = [];
async function fixture() {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  const port = new Port();
  const service = new AircraftService({
    listPorts: async () => [{ path }],
    createPort: () => port as unknown as AircraftSerialPort,
  });
  services.push(service);
  await service.connect(path);
  port.heartbeat();
  const id = service.snapshot().aircraft[0].id;
  return { service, port, id };
}
afterEach(async () => {
  for (const s of services.splice(0)) await s.dispose();
  vi.useRealTimers();
});
describe('parameter writes and independent verification', () => {
  it('reads a named setting without requesting or resetting the full parameter list', async () => {
    const { service, port, id } = await fixture();
    const pending = service.readParameters(id, ['FRAME_TYPE']);
    await vi.advanceTimersByTimeAsync(200);
    const result = await pending;
    expect(result.parameters.find((parameter) => parameter.name === 'FRAME_TYPE')?.value).toBe(12);
    expect(port.write.mock.calls.map(([buffer]) => wire.header(buffer).msgid)).toEqual([common.ParamRequestRead.MSG_ID]);
  });
  it('reads the list and verifies a reviewed write with a separate fresh read', async () => {
    const { service, port, id } = await fixture();
    expect((await service.readParameters(id)).state).toBe('complete');
    const pending = service.setParameter(id, 'FRAME_TYPE', 1, 12);
    await vi.advanceTimersByTimeAsync(800);
    expect(await pending).toMatchObject({ before: 12, after: 1 });
    const frames = port.write.mock.calls.map(([b]) => wire.header(b).msgid);
    expect(frames.filter((id) => id === common.ParamRequestRead.MSG_ID)).toHaveLength(2);
  });
  it('rejects stale expected values without setting anything', async () => {
    const { service, port, id } = await fixture();
    const pending = service.setParameter(id, 'FRAME_TYPE', 1, 0);
    const rejection = expect(pending).rejects.toThrow('changed since');
    await vi.advanceTimersByTimeAsync(200);
    await rejection;
    expect(
      port.write.mock.calls.some(([b]) => wire.header(b).msgid === common.ParamSet.MSG_ID)
    ).toBe(false);
  });
  it('does not label a rejected read-only change verified', async () => {
    const { service, port, id } = await fixture();
    port.rejectWrite = true;
    const pending = service.setParameter(id, 'FRAME_TYPE', 1, 12);
    const rejection = expect(pending).rejects.toThrow('not verified');
    await vi.advanceTimersByTimeAsync(800);
    await rejection;
  });
  it('does not reuse a cached same-millisecond parameter when a new read gets no reply', async () => {
    const { service, port, id } = await fixture();
    await service.readParameters(id);
    port.silent = true;
    const pending = service.setParameter(id, 'FRAME_TYPE', 1, 12);
    const rejection = expect(pending).rejects.toThrow('No parameter readback');
    await vi.advanceTimersByTimeAsync(3100);
    await rejection;
    expect(port.value).toBe(12);
  });
  it('blocks concurrent writes and telemetry, and aborts on disconnect', async () => {
    const { service, id } = await fixture();
    const pending = service.setParameter(id, 'FRAME_TYPE', 1, 12);
    const rejected = expect(pending).rejects.toThrow('connection changed');
    await expect(service.setParameter(id, 'FRAME_TYPE', 2, 12)).rejects.toThrow('in progress');
    await expect(service.requestTelemetry(id)).rejects.toThrow('pending');
    await service.disconnect();
    await vi.advanceTimersByTimeAsync(200);
    await rejected;
  });
  it('blocks armed or stale aircraft and external process ownership', async () => {
    const { service, port, id } = await fixture();
    port.heartbeat(true);
    await expect(service.readParameters(id)).rejects.toThrow('disarmed');
    port.heartbeat();
    await vi.advanceTimersByTimeAsync(6000);
    await expect(service.readParameters(id)).rejects.toThrow('fresh');
    await service.disconnect();
    service.setExternalBusy(() => true);
    await expect(service.connect(path)).rejects.toThrow('process');
  });
});


describe('buzzer preview safety', () => {
  const tune = { name: 'Test', bpm: 120, notes: [{ midi: 72, beats: 0.5 }] };
  it('sends a buzzer packet without claiming playback or changing parameters', async () => {
    const { service, port, id } = await fixture();
    expect(await service.playTune(id, tune, true)).toMatchObject({ state: 'sent' });
    expect(port.write.mock.calls.map(([b]) => wire.header(b).msgid)).toEqual([common.PlayTune.MSG_ID]);
    await expect(service.playTune(id, tune, true)).rejects.toThrow('Wait');
  });
  it('refuses missing props confirmation, armed and stale telemetry without writes', async () => {
    const { service, port, id } = await fixture();
    await expect(service.playTune(id, tune, false)).rejects.toThrow('propellers');
    port.heartbeat(true);
    await expect(service.playTune(id, tune, true)).rejects.toThrow('disarmed');
    port.heartbeat(false);
    await vi.advanceTimersByTimeAsync(6000);
    await expect(service.playTune(id, tune, true)).rejects.toThrow('fresh');
    expect(port.write).not.toHaveBeenCalled();
  });
});
