import { crc16 } from './esc-protocol';
export function mspReply(command: number, payload: number[] | Buffer) {
  const body = Buffer.from([payload.length, command, ...payload]);
  return Buffer.concat([Buffer.from('$M>'), body, Buffer.from([body.reduce((a, b) => a ^ b, 0)])]);
}
export function fourReply(command: number, payload: number[] | Buffer, address = 0, ack = 0) {
  const body = Buffer.from([0x2e, command, address >> 8, address & 255, payload.length & 255, ...payload, ack]);
  const check = Buffer.alloc(2); check.writeUInt16BE(crc16(body));
  return Buffer.concat([body, check]);
}
export function settings(bluejay = false) {
  const bytes = Buffer.alloc(bluejay ? 255 : 112, 0xff);
  bytes[0] = bluejay ? 0 : 16; bytes[1] = bluejay ? 21 : 7; bytes[2] = bluejay ? 208 : 33;
  bytes[0x0b] = 2; bytes[0x0d] = 0x55; bytes[0x0e] = 0xaa;
  // Firmware identity fields are fixed-width, space-padded strings.
  bytes.fill(0x20, 0x40, 0x70);
  bytes.write('#J_H_40#', 0x40); bytes.write('#BLHELI$EFM8B21#', 0x50);
  if (bluejay) bytes.write('Bluejay (.1)', 0x60);
  return bytes;
}
