// Global simulation constants. All distances are metres, times are seconds.

export const SIM_DT = 1 / 60;
export const MAX_FRAME_DT = 0.25;
export const MAX_STEPS_PER_FRAME = 30;

// Road geometry
export const LANE_WIDTH = 3.5;
export const LANES_PER_DIR = 2;
export const ROAD_HALF = LANE_WIDTH * LANES_PER_DIR; // 7
export const CROSSWALK_START = ROAD_HALF + 0.8;
export const CROSSWALK_WIDTH = 3;
export const STOP_DIST = CROSSWALK_START + CROSSWALK_WIDTH + 0.8; // stop line distance from centre
export const SIDEWALK_WIDTH = 4.5;
export const CURB_RADIUS = 4;
export const ARM_LENGTH = 120;
export const INTERSECTION_SPACING = 76;
export const LOADING_ZONE_S = 26; // front position of jeepney loading stop on curb exit lanes

// Safety
export const MIN_BUFFER = 0.45; // minimum gap between any two vehicle bodies
export const CELL_SIZE = 0.5; // intersection conflict grid resolution
export const FOOTPRINT_PAD = 0.25; // 2 * pad >= MIN_BUFFER so disjoint reservations never touch
export const GRID_EXTENSION = 10; // conflict grid reaches this far past the stop lines
export const PROBE_RANGE = STOP_DIST + 16;
export const MAX_VEHICLE_RADIUS = 6.1;

export const SIGNAL_TIMING = {
  yellow: 1.5,
  allRed: 1,
};

export const ARMS = ['N', 'E', 'S', 'W'];
// Outward unit vectors (screen coordinates, y grows downward).
export const DIRS = {
  N: { x: 0, y: -1 },
  E: { x: 1, y: 0 },
  S: { x: 0, y: 1 },
  W: { x: -1, y: 0 },
};
export const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' };
export const ARM_GROUP = { N: 'NS', S: 'NS', E: 'EW', W: 'EW' };
export const ARM_LABEL = { N: 'North', E: 'East', S: 'South', W: 'West' };
export const GROUP_LABEL = { NS: 'N–S', EW: 'E–W' };

// Driver personalities. These only change decisions; none can bypass collision checks.
export const PERSONALITIES = {
  patient: {
    key: 'patient',
    label: 'Patient',
    headway: 1.6,
    minGap: 2.6,
    stopMargin: 0.8,
    creep: false,
    creepGap: 2.0,
    patience: 24,
    hornDelay: 7,
    hornCooldown: [7, 14],
    hornChance: 0.3,
    tightAccept: 0,
    noneAccept: 0,
    leftGapTime: 5.0,
    yellowRunTime: 0,
    accelFactor: 0.9,
    speedFactor: 0.95,
  },
  impatient: {
    key: 'impatient',
    label: 'Impatient',
    headway: 1.15,
    minGap: 1.7,
    stopMargin: 0.4,
    creep: true,
    creepGap: 0.9,
    patience: 10,
    hornDelay: 2.5,
    hornCooldown: [2.5, 6],
    hornChance: 0.7,
    tightAccept: 0.45,
    noneAccept: 0.12,
    leftGapTime: 3.6,
    yellowRunTime: 1.2,
    accelFactor: 1.05,
    speedFactor: 1.03,
  },
  aggressive: {
    key: 'aggressive',
    label: 'Aggressive',
    headway: 0.85,
    minGap: 1.2,
    stopMargin: 0.2,
    creep: true,
    creepGap: 0.75,
    patience: 5,
    hornDelay: 1.0,
    hornCooldown: [1.2, 3.5],
    hornChance: 0.9,
    tightAccept: 0.8,
    noneAccept: 0.5,
    leftGapTime: 2.6,
    yellowRunTime: 2.0,
    accelFactor: 1.2,
    speedFactor: 1.08,
  },
};

export const NOTIFY_TEXT = {
  HEAVY_TRAFFIC: 'HEAVY TRAFFIC',
  INTERSECTION_BLOCKED: 'INTERSECTION BLOCKED',
  GRIDLOCK: 'GRIDLOCK DETECTED',
  HEAVY_HONKING: 'HEAVY HONKING',
  EMERGENCY: 'EMERGENCY VEHICLE APPROACHING',
  RECOVERY: 'RECOVERY IN PROGRESS',
  RESTORED: 'TRAFFIC FLOW RESTORED',
  EXIT_BLOCKED: 'EXIT ROAD BLOCKED',
  EXIT_CLEARED: 'EXIT ROAD CLEARED',
};
