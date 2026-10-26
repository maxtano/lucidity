export interface EscStartupPlan {
  id: string;
  aircraftId: string;
  createdAt: number;
  expiresAt: number;
  tuneName: string;
  melodyHex: string;
  firmware: string;
  firmwareUrl: string;
  firmwareSha256: string;
  backupPath: string;
  requiresFirmwareChange: boolean;
  escs: { index: number; from: string; direction: string; action: 'upgrade' | 'melody'; beforeSha256: string; afterSha256: string }[];
}
export interface EscStartupStatus {
  aircraftId: string;
  state: 'preparing' | 'ready' | 'installing' | 'verified' | 'failed';
  message: string;
  plan?: EscStartupPlan;
  verifiedEscs: number[];
  recoveryRequired?: boolean;
}
