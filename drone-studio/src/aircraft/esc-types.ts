/** A timestamped readback, never a claim that firmware or settings were changed. */
export interface EscIdentity {
  index: number;
  signature?: string;
  interfaceMode?: number;
  firmware?: 'BLHeli_S' | 'Bluejay' | 'Unknown';
  version?: string;
  firmwareName?: string;
  layout?: string;
  layoutRevision?: number;
  mcu?: string;
  direction?: string;
  beepStrength?: number;
  beaconStrength?: number;
  startupMelody?: 'supported' | 'unsupported' | 'unknown';
  settingsHex?: string;
  error?: string;
}
export interface EscInspection {
  aircraftId: string;
  path: string;
  serialNumber?: string;
  startedAt: number;
  finishedAt?: number;
  state: 'reading' | 'complete' | 'partial' | 'failed';
  message: string;
  count: number;
  escs: EscIdentity[];
  telemetryRestored: boolean;
}
