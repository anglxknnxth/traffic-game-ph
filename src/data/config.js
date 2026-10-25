// Global simulation constants. All distances are metres, times are seconds.

export const SIM_DT = 1 / 60;
export const MAX_FRAME_DT = 0.25;
export const MAX_STEPS_PER_FRAME = 30;

// Road geometry
export const LANE_WIDTH = 3.5;
export const BIKE_LANE_WIDTH = 2.2;
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
  // The whole change (yellow + all-red) takes 2 s.
  yellow: 1.2,
  allRed: 0.8,
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
    reaction: [0.55, 0.95],
    laneChangeGain: 0.7,
    politeness: 0.5,
    safeDecel: 2.5,
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
    reaction: [0.4, 0.7],
    laneChangeGain: 0.35,
    politeness: 0.25,
    safeDecel: 3.2,
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
    reaction: [0.25, 0.5],
    laneChangeGain: 0.15,
    politeness: 0.05,
    safeDecel: 4,
  },
  // Slow to react when the light turns green, keeps long gaps, rarely honks or changes lanes.
  cautious: {
    key: 'cautious',
    label: 'Cautious',
    headway: 2.0,
    minGap: 3.0,
    stopMargin: 1.0,
    creep: false,
    creepGap: 2.4,
    patience: 35,
    hornDelay: 12,
    hornCooldown: [10, 20],
    hornChance: 0.1,
    tightAccept: 0,
    noneAccept: 0,
    leftGapTime: 6.0,
    yellowRunTime: 0,
    accelFactor: 0.8,
    speedFactor: 0.9,
    reaction: [1.2, 1.8],
    laneChangeGain: 1.1,
    politeness: 0.8,
    safeDecel: 2,
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
  FLASH: 'FLASHING YELLOW · STOP & GO',
  CORNER_STOP: 'JEEP NAGBABABA SA KANTO',
  RTOR: 'RIGHT TURN ON RED · KANAN KAHIT PULA (MAG-INGAT)',
  PAIRED: 'NO LEFT TURN · SABAY ANG MAGKATAPAT',
  PRIORITY_PASS: 'PINADAAN! · STUCK CAR WAVED THROUGH',
};
