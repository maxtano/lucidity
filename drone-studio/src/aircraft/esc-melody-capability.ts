import type { EscIdentity, EscInspection } from './esc-types';
import { encodeBluejayMelody } from '../platform/bluejay-melody';
import type { Tune } from '../platform/music-model';

export const melodyHex = (tune: Tune) => Array.from(encodeBluejayMelody(tune), byte => byte.toString(16).padStart(2, '0')).join('');

export function supportedMusicEsc(esc: EscIdentity) {
  return !esc.error && esc.signature === '0xE8B2' && esc.interfaceMode === 1 &&
    esc.layout === 'J-H-40' && esc.mcu === '#BLHELI$EFM8B21#' &&
    esc.firmware === 'Bluejay' && esc.version === '0.21' && esc.firmwareName === 'Bluejay (.0)' &&
    esc.layoutRevision === 208 && ['Normal', 'Reversed'].includes(esc.direction ?? '');
}

export function hasInstalledMelody(report: EscInspection | undefined, tune: Tune) {
  try {
    const hex = melodyHex(tune);
    return !!report && report.count === 4 && report.escs.length === 4 && report.escs.every(esc =>
      supportedMusicEsc(esc) && esc.settingsHex?.slice(10, 12) === '01' && esc.settingsHex.slice(0x70 * 2, 0xf0 * 2) === hex);
  } catch { return false; }
}

