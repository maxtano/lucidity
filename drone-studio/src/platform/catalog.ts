export type ToolId =
  | 'drone-check'
  | 'setup'
  | 'parameters'
  | 'airframe'
  | 'ports'
  | 'receiver'
  | 'modes'
  | 'power'
  | 'sensors'
  | 'motors'
  | 'esc'
  | 'tuning'
  | 'safety'
  | 'firmware'
  | 'radios'
  | 'osd'
  | 'lights'
  | 'missions'
  | 'diagnostics';
export interface ToolGroup {
  id: ToolId;
  name: string;
  description: string;
  features: string[];
  families: string[];
  prefixes: string[];
  capability: string;
  action: 'connection' | 'parameters' | 'motors' | 'firmware' | 'esc' | 'checkup' | 'radio' | 'flight-logs' | 'planned';
}
export const toolGroups: ToolGroup[] = [
  {
    id: 'drone-check', name: 'Check my drone',
    description: 'Beta: one guided experience for connection, configuration, hands-on checks and a saved report.',
    features: ['Fresh device evidence', 'Versioned configuration rules', 'Props-off observations', 'Independent radio path check', 'Saved reports with outstanding checks'],
    families: ['ArduPilot', 'Bluejay', 'BLHeli_S'], prefixes: [], capability: 'Beta · guided diagnostics', action: 'checkup',
  },
  {
    id: 'setup',
    name: 'Guided setup',
    description: 'From the first cable to a checked connection.',
    features: [
      'Detect USB devices',
      'Identify the autopilot',
      'Request firmware and sensor readings',
      'Verify the return link',
      'Explain the next physical step',
    ],
    families: ['ArduPilot', 'MAVLink'],
    prefixes: [],
    capability: 'Live connection tools',
    action: 'connection',
  },
  {
    id: 'parameters',
    name: 'All parameters',
    description: 'The complete list reported by your flight controller.',
    features: [
      'Search raw names and values',
      'Read the full parameter list',
      'Review one change at a time',
      'Write and verify with readback',
      'Download a configuration snapshot',
      'Compare an imported backup',
    ],
    families: ['ArduPilot'],
    prefixes: [],
    capability: 'Read, edit & verify',
    action: 'parameters',
  },
  {
    id: 'airframe',
    name: 'Frame & outputs',
    description: 'Airframe geometry, board orientation, and output assignments.',
    features: [
      'Frame class and type',
      'Board orientation',
      'Motor and servo functions',
      'Output minimum, maximum and trim',
      'Output protocol settings',
    ],
    families: ['ArduPilot', 'PX4', 'Betaflight'],
    prefixes: ['FRAME_', 'AHRS_ORIENTATION', 'SERVO', 'MOT_'],
    capability: 'ArduPilot parameters',
    action: 'parameters',
  },
  {
    id: 'ports',
    name: 'Ports & peripherals',
    description: 'See what each UART connects to.',
    features: [
      'Serial port protocols',
      'Baud rates',
      'GPS and receiver ports',
      'Telemetry routing',
      'Peripheral options',
      'CAN bus configuration',
    ],
    families: ['ArduPilot', 'PX4', 'Betaflight'],
    prefixes: ['SERIAL', 'CAN_', 'CAN_D'],
    capability: 'ArduPilot parameters',
    action: 'parameters',
  },
  {
    id: 'receiver',
    name: 'Radio setup',
    description: 'See live stick and switch input from the connected aircraft.',
    features: [
      'RC channel mapping',
      'Input endpoints and trims',
      'Receiver protocol',
      'Deadbands',
      'RSSI and link quality',
      'Receiver failsafe settings',
    ],
    families: ['ArduPilot', 'PX4', 'Betaflight'],
    prefixes: ['RC', 'RSSI'],
    capability: 'Live RC monitor',
    action: 'radio',
  },
  {
    id: 'modes',
    name: 'Modes & switches',
    description: 'Assign switches and flight behaviors.',
    features: [
      'Flight mode slots',
      'Auxiliary switch functions',
      'Arming configuration',
      'Turtle/flip-over settings where supported',
      'Adjustment ranges',
    ],
    families: ['ArduPilot', 'PX4', 'Betaflight'],
    prefixes: ['FLTMODE', 'RC', 'ARMING_'],
    capability: 'ArduPilot parameters',
    action: 'parameters',
  },
  {
    id: 'power',
    name: 'Power & battery',
    description: 'Battery monitoring, limits, and power measurements.',
    features: [
      'Monitor type',
      'Voltage and current calibration',
      'Capacity and cell thresholds',
      'Battery failsafes',
      'ESC telemetry settings',
    ],
    families: ['ArduPilot', 'PX4', 'Betaflight'],
    prefixes: ['BATT', 'ESC_'],
    capability: 'ArduPilot parameters',
    action: 'parameters',
  },
  {
    id: 'sensors',
    name: 'Sensors & GPS',
    description: 'Inspect sensor settings and live readings, and calibrate level on a supported ArduCopter.',
    features: [
      'Accelerometer and gyro settings',
      'Compass configuration',
      'GPS configuration',
      'Sensor orientation',
      'Rangefinders and optical flow',
      'Live attitude and GPS',
      'Guarded ArduCopter level calibration',
      'Other guided sensor calibration (adapter pending)',
    ],
    families: ['ArduPilot', 'PX4', 'Betaflight'],
    prefixes: ['AHRS_TRIM_', 'INS_', 'COMPASS_', 'GPS', 'RNGFND', 'FLOW_', 'BARO_'],
    capability: 'Parameters, live readings & level calibration',
    action: 'parameters',
  },
  {
    id: 'motors',
    name: 'Motor tests',
    description: 'A deliberate, timed test of one motor at a time.',
    features: [
      'Select motor test A–D',
      '5% power / one-second pulse',
      'Explicit props-off checks',
      'Stop request',
      'Show acknowledgement separately from movement',
      'Physical order and direction checks',
    ],
    families: ['ArduPilot'],
    prefixes: ['MOT_', 'SERVO'],
    capability: 'Bounded bench test',
    action: 'motors',
  },
  {
    id: 'esc',
    name: 'ESC configuration',
    description: 'Read motor-controller firmware and settings over direct ArduPilot USB.',
    features: ['Read SiLabs ESC identities and versions', 'Read direction and beep settings', 'Detect Bluejay startup melody support', 'Download the raw settings readback', 'Music supports reviewed Bluejay startup installation for J-H-40 ESCs; arbitrary PWM changes are unavailable'],
    families: ['Bluejay', 'BLHeli_S'],
    prefixes: [],
    capability: 'Read-only ESC inspection',
    action: 'esc',
  },
  {
    id: 'tuning',
    name: 'PID, rates & filters',
    description: 'Keep the full tuning surface within reach.',
    features: [
      'Roll, pitch and yaw gains',
      'Rate and acceleration limits',
      'Gyro and D-term filters',
      'Notch and harmonic filters',
      'Feedforward',
      'Autotune settings',
      'Profiles and presets',
    ],
    families: ['ArduPilot', 'PX4', 'Betaflight'],
    prefixes: ['ATC_', 'PSC_', 'PILOT_', 'INS_', 'AUTOTUNE_', 'ACRO_'],
    capability: 'ArduPilot parameters',
    action: 'parameters',
  },
  {
    id: 'safety',
    name: 'Failsafes & limits',
    description: 'Inspect the aircraft’s own failure responses.',
    features: [
      'Radio loss response',
      'Battery failsafes',
      'Ground station link loss',
      'Geofence and altitude limits',
      'Return-to-home settings',
      'Arming checks',
    ],
    families: ['ArduPilot', 'PX4', 'Betaflight'],
    prefixes: ['FS_', 'FENCE_', 'RTL_', 'ARMING_', 'BATT_FS'],
    capability: 'ArduPilot parameters',
    action: 'parameters',
  },
  {
    id: 'firmware',
    name: 'Firmware flasher',
    description: 'Identify the target, prepare firmware, and verify the flash.',
    features: [
      'ESP chip identification',
      'Local binary selection',
      'SHA-256 file checksum',
      'Explicit flash address',
      'esptool flash and verification',
      'FC DFU / bootloader support (adapter pending)',
      'Firmware recovery plans',
    ],
    families: ['ESP32', 'ArduPilot', 'PX4', 'Betaflight'],
    prefixes: [],
    capability: 'ESP through local esptool',
    action: 'firmware',
  },
  {
    id: 'radios',
    name: 'ESP & radio links',
    description: 'Ground radio, air radio, and the path between them.',
    features: [
      'USB radio discovery',
      'MAVLink heartbeat checks',
      'Return-link verification',
      'ESP firmware flashing',
      'DroneBridge ground-mode recovery',
      'Pairing and channel configuration (adapter pending)',
      'ELRS configuration (adapter pending)',
    ],
    families: ['ESP32', 'MAVLink', 'ELRS'],
    prefixes: ['SERIAL', 'RC_PROTOCOLS'],
    capability: 'Connect, inspect & flash ESP',
    action: 'connection',
  },
  {
    id: 'osd',
    name: 'OSD & video',
    description: 'On-screen display, video transmitter, and camera settings.',
    features: [
      'OSD elements and layout',
      'DisplayPort settings',
      'Video channels and power tables',
      'SmartAudio / Tramp',
      'Camera and gimbal configuration',
    ],
    families: ['Betaflight', 'ArduPilot'],
    prefixes: ['OSD', 'VTX_', 'CAM_', 'MNT'],
    capability: 'ArduPilot parameters; visual editor pending',
    action: 'parameters',
  },
  {
    id: 'lights',
    name: 'LEDs & accessories',
    description: 'Lights, buzzers, servos, and attached devices.',
    features: [
      'LED outputs',
      'Notifications and buzzer settings',
      'Servo assignments',
      'Relay functions',
      'Lighting firmware workflow',
    ],
    families: ['ArduPilot', 'Betaflight', 'ESP32'],
    prefixes: ['NTF_', 'RELAY', 'SERVO'],
    capability: 'ArduPilot parameters',
    action: 'parameters',
  },
  {
    id: 'missions',
    name: 'Missions & geofence',
    description: 'A future bridge from a designed show to aircraft missions.',
    features: [
      'Mission planning and upload',
      'Mission download and readback',
      'Rally points',
      'Geofence upload',
      'Fleet assignment',
      'Operational preflight checks',
    ],
    families: ['ArduPilot', 'PX4'],
    prefixes: [],
    capability: 'Mission adapter needed',
    action: 'planned',
  },
  {
    id: 'diagnostics',
    name: 'Flight logs',
    description: 'Retrieve and inspect a recorded ArduPilot flight without leaving Lucidity.',
    features: [
      'List onboard DataFlash logs',
      'Download a complete .BIN with progress and cancellation',
      'Inspect a read-only flight report',
      'Save the original log for deeper analysis',
    ],
    families: ['ArduPilot', 'MAVLink'],
    prefixes: [],
    capability: 'Read-only flight review',
    action: 'flight-logs',
  },
];
export function findTools(query: string) {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return toolGroups.filter((tool) =>
    words.every((word) =>
      `${tool.name} ${tool.description} ${tool.features.join(' ')} ${tool.families.join(' ')} ${tool.prefixes.join(' ')}`
        .toLowerCase()
        .includes(word)
    )
  );
}
export const parameterLabel = (name: string, value: number) => {
  if (/^SERVO\d+_FUNCTION$/.test(name) && value >= 33 && value <= 36) return `Motor ${value - 32}`;
  if (name === 'FRAME_TYPE')
    return ({ 0: 'Plus', 1: 'X', 2: 'V', 3: 'H', 12: 'BetaFlightX' } as Record<number, string>)[
      value
    ];
  if (name === 'FRAME_CLASS')
    return ({ 1: 'Quad', 2: 'Hexa', 3: 'Octa', 4: 'OctaQuad', 5: 'Y6' } as Record<number, string>)[
      value
    ];
  return undefined;
};
