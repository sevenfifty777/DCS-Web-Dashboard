import type { ParkingSpot } from './deckTracking';

export interface DeckSpotVisualStyle {
  color: string;
  legendLabel: string;
}

const FIXED_WING_SPOT_STYLE: DeckSpotVisualStyle = {
  color: '#00e5ff',
  legendLabel: 'FIXED-WING',
};
const HELICOPTER_SPOT_STYLE: DeckSpotVisualStyle = {
  color: '#ff4fd8',
  legendLabel: 'HELO',
};
const LAUNCH_SPOT_STYLE: DeckSpotVisualStyle = {
  color: '#ffbf00',
  legendLabel: 'LAUNCH',
};

export const DECK_SPOT_LEGEND = [
  FIXED_WING_SPOT_STYLE,
  HELICOPTER_SPOT_STYLE,
  LAUNCH_SPOT_STYLE,
] as const;

export const DECK_SPOT_STYLES = {
  'fixed-wing': FIXED_WING_SPOT_STYLE,
  helicopter: HELICOPTER_SPOT_STYLE,
  catapult: LAUNCH_SPOT_STYLE,
  stovl: LAUNCH_SPOT_STYLE,
} as const satisfies Readonly<Record<NonNullable<ParkingSpot['kind']>, DeckSpotVisualStyle>>;

function fixedWingParkingSpot(
  termIndex: number,
  fwd: number,
  right: number,
): ParkingSpot {
  return {
    term_index: termIndex,
    position: { u: fwd, v: right },
    isLocal: true,
    kind: 'fixed-wing',
    // DCS parking aircraft face toward the deck centerline: port-side spots
    // point starboard and starboard-side spots point port.
    deckHeadingDegrees: right < 0 ? 90 : -90,
  };
}

function helicopterParkingSpot(
  termIndex: string | number,
  fwd: number,
  right: number,
): ParkingSpot {
  return {
    term_index: termIndex,
    position: { u: fwd, v: right },
    isLocal: true,
    kind: 'helicopter',
    deckHeadingDegrees: 0,
  };
}

function launchSpot(
  termIndex: number,
  fwd: number,
  right: number,
  kind: 'catapult' | 'stovl',
): ParkingSpot {
  return {
    term_index: termIndex,
    position: { u: fwd, v: right },
    isLocal: true,
    kind,
  };
}

// CoreMods/tech/USS_Nimitz/scripts/USS_Nimitz_RunwaysAndRoutes.lua
// Coordinates are DCS local-carrier x (forward) and z (right/starboard).
export const NIMITZ_SPOTS: ParkingSpot[] = [
  fixedWingParkingSpot(1, -141.15, 24.2),
  fixedWingParkingSpot(2, -129.2, 26.2),
  fixedWingParkingSpot(3, -118, 28),
  fixedWingParkingSpot(4, -103.5, 34),
  fixedWingParkingSpot(5, -92, 34),
  fixedWingParkingSpot(6, -79, 26.5),
  fixedWingParkingSpot(7, -65.8, 18.8),
  fixedWingParkingSpot(8, -52, 17),
  fixedWingParkingSpot(9, -37, 16),
  fixedWingParkingSpot(10, -23, 34),
  fixedWingParkingSpot(11, -11, 34),
  fixedWingParkingSpot(12, 6, 32.5),
  fixedWingParkingSpot(13, 69.6, 33),
  fixedWingParkingSpot(14, 53, 34.5),
  fixedWingParkingSpot(15, 23, 34),
  fixedWingParkingSpot(16, 35, 34),
  fixedWingParkingSpot(17, 24.5, 9.5),
  fixedWingParkingSpot(18, 7.6, 10.5),
  fixedWingParkingSpot(19, -9.9, 10.8),
  fixedWingParkingSpot(20, -26, 12),
  fixedWingParkingSpot(21, -96, -34),
  fixedWingParkingSpot(22, -108, -34),
  launchSpot(23, 55, 18.54, 'catapult'),
  launchSpot(24, 55.9, -3.68, 'catapult'),
  launchSpot(25, -39.4, -19.92, 'catapult'),
  launchSpot(26, -58.5, -32.8, 'catapult'),

  // GT.HelicopterSpawnTerminal. DCS direction 0 means ship-forward.
  helicopterParkingSpot('H1', 147, -0.18),
  helicopterParkingSpot('H2', 113, -10.3),
  helicopterParkingSpot('H3', 55, -31.45),
  helicopterParkingSpot('H4', 20.6, -28.75),
  helicopterParkingSpot('H5', -8.9, -28.75),
  helicopterParkingSpot('H6', -39.7, -28.75),
  helicopterParkingSpot('H7', -100.6, -31),
  helicopterParkingSpot('H8', -94.8, 32.2),
];

// CoreMods/aircraft/AV8BNA/TarawaRunwaysAndRoutes.lua
export const TARAWA_SPOTS: ParkingSpot[] = [
  fixedWingParkingSpot(1, 90, 14),
  fixedWingParkingSpot(2, 75, 14),
  fixedWingParkingSpot(3, 60, 14),
  fixedWingParkingSpot(4, 45, 14),
  fixedWingParkingSpot(5, -115, 14),
  fixedWingParkingSpot(6, -100, 14),
  fixedWingParkingSpot(7, -85, 14),
  fixedWingParkingSpot(8, -70, 14),
  helicopterParkingSpot('H1', 102.3, 0.5),
  helicopterParkingSpot('H2', 78.2, 13.65),
  helicopterParkingSpot('H3', 78.2, -14),
  helicopterParkingSpot('H4', 47.2, -14),
  helicopterParkingSpot('H5', 15.8, -14),
  helicopterParkingSpot('H6', -15, -14),
  helicopterParkingSpot('H7', -46.5, -14),
  helicopterParkingSpot('H8', -91, -14),
  launchSpot(17, -35, -5.5, 'stovl'),
  launchSpot(18, -60, -6.2, 'stovl'),
  launchSpot(19, -65, -6.5, 'stovl'),
  launchSpot(20, -110, -7.5, 'stovl'),
];
