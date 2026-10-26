import { expect, it } from 'vitest';
import { MavLinkProtocolV2, common, x25crc } from 'node-mavlink';
import { flightCommandFrame, type FlightCommand } from './flight-command-wire';

const commands: FlightCommand[] = [
  { command: 224, targetSystem: 1, targetComponent: 1, params: [1, 0, 0, 0, 0, 0, 0] },
  { command: 400, targetSystem: 1, targetComponent: 1, params: [1, 0, 0, 0, 0, 0, 0] },
  { command: 300, targetSystem: 1, targetComponent: 1, params: [0, 0, 0, 0, 0, 0, 0] },
  { command: 176, targetSystem: 1, targetComponent: 1, params: [1, 9, 0, 0, 0, 0, 0] },
];

it('serializes only the four fixed reviewed mission commands from Lucidity ground identity', () => {
  const protocol = new MavLinkProtocolV2();
  for (const [index, command] of commands.entries()) {
    const frame = flightCommandFrame(command, index);
    expect(protocol.header(frame)).toMatchObject({ sysid: 254, compid: 190, msgid: 76, seq: index });
    expect(protocol.crc(frame)).toBe(x25crc(frame, 1, 2, common.CommandLong.MAGIC_NUMBER));
    const decoded = protocol.data(protocol.payload(frame), common.CommandLong);
    expect(decoded).toMatchObject({ targetSystem: 1, targetComponent: 1,
      command: command.command, confirmation: 0 });
    expect([decoded._param1, decoded._param2, decoded._param3, decoded._param4,
      decoded._param5, decoded._param6, decoded._param7]).toEqual(command.params);
  }
});

it('rejects any changed target, force arm, manual disarm, flight mode, or extra parameter', () => {
  for (const command of commands) {
    expect(() => flightCommandFrame({ ...command, targetSystem: 254 }, 0)).toThrow();
    expect(() => flightCommandFrame({ ...command, targetComponent: 0 }, 0)).toThrow();
    expect(() => flightCommandFrame({ ...command, params: [2, command.params[1], command.params[2],
      command.params[3], command.params[4], command.params[5], command.params[6]] }, 0)).toThrow();
  }
  expect(() => flightCommandFrame({ ...commands[1], params: [0, 0, 0, 0, 0, 0, 0] }, 0)).toThrow();
  expect(() => flightCommandFrame({ ...commands[1], params: [1, 21196, 0, 0, 0, 0, 0] }, 0)).toThrow();
  expect(() => flightCommandFrame({ ...commands[3], params: [1, 3, 0, 0, 0, 0, 0] }, 0)).toThrow();
  expect(() => flightCommandFrame({ ...commands[0], command: 310 as 224 }, 0)).toThrow();
});
