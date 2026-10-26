import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { common, minimal, MavLinkProtocolV2 } from 'node-mavlink';
import { AircraftService, type AircraftSerialPort } from './service';

const path = '/dev/cu.usbmodemLEVEL';
const wire = new MavLinkProtocolV2(1, 1);
const confirmations = {
  propsRemoved: true, batteryDisconnected: true, physicallyLevel: true,
  still: true, directUsb: true, confirmed: true,
} as const;

class Port extends EventEmitter {
  isOpen = false;
  now = 1000;
  ackResult: number | null = 0;
  trims = { AHRS_TRIM_X: 0.05, AHRS_TRIM_Y: -0.02 };
  write = vi.fn((frame: Buffer, callback: (error: Error | null) => void) => {
    callback(null);
    const id = wire.header(frame).msgid;
    if (id === common.ParamRequestRead.MSG_ID) {
      const name = wire.data(wire.payload(frame), common.ParamRequestRead).paramId as keyof Port['trims'];
      const reply = new common.ParamValue();
      reply.paramId = name; reply.paramValue = this.trims[name]; reply.paramType = 9;
      reply.paramIndex = name === 'AHRS_TRIM_X' ? 0 : 1; reply.paramCount = 2;
      this.emit('data', wire.serialize(reply, 0));
    }
    if (id === common.CommandLong.MSG_ID) {
      const command = wire.data(wire.payload(frame), common.CommandLong);
      if (command.command === 241 && this.ackResult !== null) {
        if (this.ackResult === 0) this.trims = { AHRS_TRIM_X: 0.01, AHRS_TRIM_Y: -0.01 };
        const ack = new common.CommandAck();
        ack.command = 241; ack.result = this.ackResult; ack.targetSystem = 254; ack.targetComponent = 190;
        this.emit('data', wire.serialize(ack, 0));
      }
      if (command.command === 512 && command._param1 === 30) { this.now += 100; this.attitude(0.01, -0.01); }
    }
    return true;
  });
  open(callback: (error: Error | null) => void) { this.isOpen = true; callback(null); }
  close(callback: (error: Error | null) => void) { this.isOpen = false; this.emit('close'); callback(null); }
  heartbeat(armed = false) {
    const h = new minimal.Heartbeat();
    h.type = 2; h.autopilot = 3; h.baseMode = (armed ? 128 : 0) as minimal.MavModeFlag;
    this.emit('data', wire.serialize(h, 0));
  }
  attitude(roll: number, pitch: number) {
    const a = new common.Attitude(); a.roll = roll; a.pitch = pitch;
    this.emit('data', wire.serialize(a, 0));
  }
  battery(voltageMv: number) {
    const status = new common.SysStatus(); status.voltageBattery = voltageMv;
    this.emit('data', wire.serialize(status, 0));
  }
}

const services: AircraftService[] = [];
async function fixture(manufacturer = 'ArduPilot') {
  const port = new Port();
  const service = new AircraftService({
    listPorts: async () => [{ path, manufacturer, serialNumber: 'test' }],
    createPort: () => port as unknown as AircraftSerialPort,
    now: () => port.now,
    levelCalibrationWait: async ms => { port.now += ms; },
  });
  services.push(service);
  await service.connect(path);
  port.heartbeat();
  port.attitude(0.05, -0.02);
  return { service, port, aircraftId: service.snapshot().aircraft[0].id };
}
afterEach(async () => {
  for (const service of services.splice(0)) await service.dispose();
});

describe('guarded ArduCopter level calibration', () => {
  it('sends only board-level trim calibration and reports ACK, fresh trim readback and attitude', async () => {
    const { service, port, aircraftId } = await fixture();
    const pending = service.calibrateLevel(aircraftId, confirmations);
    const result = await pending;
    expect(result).toMatchObject({
      state: 'accepted', ack: { result: 0 },
      before: { AHRS_TRIM_X: Math.fround(0.05), AHRS_TRIM_Y: Math.fround(-0.02) },
      after: { AHRS_TRIM_X: Math.fround(0.01), AHRS_TRIM_Y: Math.fround(-0.01) },
    });
    expect(result.before.attitude?.rollDeg).toBeCloseTo(0.05 * 180 / Math.PI);
    expect(result.after.attitude?.rollDeg).toBeCloseTo(0.01 * 180 / Math.PI);
    expect(result.after.attitude!.receivedAt).toBeGreaterThan(result.before.attitude!.receivedAt);
    const frames = port.write.mock.calls.map(([frame]) => ({
      id: wire.header(frame).msgid,
      command: wire.header(frame).msgid === common.CommandLong.MSG_ID
        ? wire.data(wire.payload(frame), common.CommandLong) : null,
    }));
    expect(frames.filter(frame => frame.id === common.ParamRequestRead.MSG_ID)).toHaveLength(4);
    expect(frames.some(frame => frame.id === common.ParamSet.MSG_ID)).toBe(false);
    const calibration = frames.filter(frame => frame.command?.command === 241);
    expect(calibration).toHaveLength(1);
    expect(calibration[0].command).toMatchObject({
      targetSystem: 1, targetComponent: 1, confirmation: 0,
      _param1: 0, _param2: 0, _param3: 0, _param4: 0,
      _param5: 2, _param6: 0, _param7: 0,
    });
    expect(result.message).toMatch(/does not prove physical level/);
  });

  it('reports a rejected ACK without claiming calibration succeeded', async () => {
    const { service, port, aircraftId } = await fixture();
    port.ackResult = 4;
    const pending = service.calibrateLevel(aircraftId, confirmations);
    const result = await pending;
    expect(result.state).toBe('rejected');
    expect(result.ack?.result).toBe(4);
    expect(result.after.AHRS_TRIM_X).toBe(result.before.AHRS_TRIM_X);
  });

  it('reports missing ACK as unconfirmed, without retrying calibration', async () => {
    const { service, port, aircraftId } = await fixture();
    port.ackResult = null;
    const pending = service.calibrateLevel(aircraftId, confirmations);
    const result = await pending;
    expect(result).toMatchObject({ state: 'unconfirmed', ack: null });
    expect(result.message).toMatch(/outcome is unknown/);
    const commands = port.write.mock.calls.filter(([frame]) =>
      wire.header(frame).msgid === common.CommandLong.MSG_ID &&
      wire.data(wire.payload(frame), common.CommandLong).command === 241);
    expect(commands).toHaveLength(1);
  });

  it('refuses stale, armed, radio-path and malformed requests before calibration writes', async () => {
    const stale = await fixture();
    stale.port.now = 7000;
    await expect(stale.service.calibrateLevel(stale.aircraftId, confirmations)).rejects.toThrow(/fresh/);
    expect(stale.port.write).not.toHaveBeenCalled();

    const armed = await fixture();
    armed.port.heartbeat(true);
    await expect(armed.service.calibrateLevel(armed.aircraftId, confirmations)).rejects.toThrow(/disarmed/);
    expect(armed.port.write).not.toHaveBeenCalled();

    const radio = await fixture('Espressif ESP32');
    await expect(radio.service.calibrateLevel(radio.aircraftId, confirmations)).rejects.toThrow(/direct ArduPilot USB/);
    expect(radio.port.write).not.toHaveBeenCalled();

    const powered = await fixture();
    powered.port.battery(16000);
    await expect(powered.service.calibrateLevel(powered.aircraftId, confirmations)).rejects.toThrow(/flight-battery voltage/);
    expect(powered.port.write).not.toHaveBeenCalled();

    const malformed = await fixture();
    await expect(malformed.service.calibrateLevel(malformed.aircraftId,
      { ...confirmations, batteryDisconnected: false } as unknown as typeof confirmations)).rejects.toThrow(/Confirm/);
    expect(malformed.port.write).not.toHaveBeenCalled();
  });
});
