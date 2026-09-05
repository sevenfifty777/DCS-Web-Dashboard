import type { LaunchSpotKind, ParkingSpot } from './deckTracking';

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
  'deck-run': LAUNCH_SPOT_STYLE,
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
  kind: LaunchSpotKind,
  launchLabel?: string,
): ParkingSpot {
  return {
    term_index: termIndex,
    position: { u: fwd, v: right },
    isLocal: true,
    kind,
    ...(launchLabel ? { launchLabel } : {}),
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

// The tables below follow the DCS convention used for the Nimitz: terminals
// 1..N are the parking spots at the end of GT.TaxiRoutes, then the spawn
// spots of GT.TaxiForTORoutes that do not coincide with a parking spot, then
// the launch positions, then the GT.HelicopterSpawnTerminal points as H1..Hn.
// Sources: Features/Carrier info/*_RunwaysAndRoutes.lua.

// CV-59-Forrestal_RunwaysAndRoutes.lua (Heatblur Forrestal).
export const FORRESTAL_SPOTS: ParkingSpot[] = [
  // Starboard row behind the island, stern to bow.
  fixedWingParkingSpot(1, -70.3, 32.8),
  fixedWingParkingSpot(2, -59.8, 32.8),
  fixedWingParkingSpot(3, -49.3, 32.8),
  fixedWingParkingSpot(4, -38.8, 32.8),
  fixedWingParkingSpot(5, -28.3, 32.8),
  fixedWingParkingSpot(6, -17.8, 32.8),
  // Forward of the island.
  fixedWingParkingSpot(7, 40, 32.8),
  fixedWingParkingSpot(8, 50.5, 32.8),
  // Six-pack spawn spots.
  fixedWingParkingSpot(9, 58.2, 1.3),
  fixedWingParkingSpot(10, 47.2, 3.2),
  fixedWingParkingSpot(11, 36, 5.6),
  fixedWingParkingSpot(12, 24.4, 7.8),
  launchSpot(13, 82.4, 12.7, 'catapult', 'CAT 1'),
  launchSpot(14, 83.3, -13.1, 'catapult', 'CAT 2'),
  launchSpot(15, -36.6, -19.3, 'catapult', 'CAT 3'),
  launchSpot(16, -47, -33, 'catapult', 'CAT 4'),
  helicopterParkingSpot('H1', -58.2, -31.9),
  helicopterParkingSpot('H2', 59.4, -29.9),
  helicopterParkingSpot('H3', -119.6, -9.3),
  helicopterParkingSpot('H4', -96.4, 7.1),
  helicopterParkingSpot('H5', 171, -8.3),
  helicopterParkingSpot('H6', 151.2, 7.2),
  helicopterParkingSpot('H7', -70, -9.3),
  helicopterParkingSpot('H8', -46.9, 7.1),
  helicopterParkingSpot('H9', -21.3, -9.3),
  helicopterParkingSpot('H10', 1.9, 7.1),
  helicopterParkingSpot('H11', 28.3, -9.3),
  helicopterParkingSpot('H12', 51.5, 7.1),
  helicopterParkingSpot('H13', 78.5, -9.3),
  helicopterParkingSpot('H14', 101.7, 7.1),
  helicopterParkingSpot('H15', 128, -9.3),
  helicopterParkingSpot('H16', 3, -29.7),
];

// CV_1143_5_RunwaysAndRoutes.lua (Admiral Kuznetsov 2017). Take-off is a
// deck run over the ski jump from one of three start positions.
export const KUZNETSOV_SPOTS: ParkingSpot[] = [
  fixedWingParkingSpot(1, -105.17, 15.7),
  fixedWingParkingSpot(2, -90.45, 18.3),
  fixedWingParkingSpot(3, -76.4, 18.4),
  fixedWingParkingSpot(4, -60.8, 19.2),
  fixedWingParkingSpot(5, -31.6, 13.06),
  fixedWingParkingSpot(6, -9, 10.7),
  fixedWingParkingSpot(7, 5.2, 9.7),
  fixedWingParkingSpot(8, 19.7, 9.7),
  fixedWingParkingSpot(9, 32, 10),
  launchSpot(10, 78.35, 11.23, 'deck-run', 'RAMP 1'),
  launchSpot(11, 78.33, -11.23, 'deck-run', 'RAMP 2'),
  launchSpot(12, -14.26, -20.3, 'deck-run', 'RAMP 3'),
  helicopterParkingSpot('H1', 115.8, -7.62),
  helicopterParkingSpot('H2', 91.6, -9),
  helicopterParkingSpot('H3', 73.2, -27.9),
  helicopterParkingSpot('H4', 50.4, -27.9),
  helicopterParkingSpot('H5', 24.4, -22.5),
  helicopterParkingSpot('H6', -2.2, -21.7),
  helicopterParkingSpot('H7', -53, -25),
  helicopterParkingSpot('H8', -92, -3.7),
];

// Essex_Class_Carrier_1944_RunwaysAndRoutes.lua. Forward deck park in rows
// of three (port, starboard, centre), aft spawn rows, one deck-run take-off.
export const ESSEX_SPOTS: ParkingSpot[] = [
  fixedWingParkingSpot(1, 137, -10.5),
  fixedWingParkingSpot(2, 137, 10.5),
  fixedWingParkingSpot(3, 137, 0),
  fixedWingParkingSpot(4, 126, -10.5),
  fixedWingParkingSpot(5, 126, 10.5),
  fixedWingParkingSpot(6, 126, 0),
  fixedWingParkingSpot(7, 115, -10.5),
  fixedWingParkingSpot(8, 115, 10.5),
  fixedWingParkingSpot(9, 115, 0),
  fixedWingParkingSpot(10, 104, -10.5),
  fixedWingParkingSpot(11, 104, 10.5),
  fixedWingParkingSpot(12, 93, -10.5),
  fixedWingParkingSpot(13, 93, 10.5),
  fixedWingParkingSpot(14, 82, -10.5),
  fixedWingParkingSpot(15, 82, 10.5),
  // Elevators (despawn points).
  fixedWingParkingSpot(16, 101, 0),
  fixedWingParkingSpot(17, 27, -19),
  // Aft spawn rows.
  fixedWingParkingSpot(18, -60, -5.5),
  fixedWingParkingSpot(19, -60, 3),
  fixedWingParkingSpot(20, -60, -14),
  fixedWingParkingSpot(21, -60, 11.5),
  fixedWingParkingSpot(22, -75, -5.5),
  fixedWingParkingSpot(23, -75, 3),
  fixedWingParkingSpot(24, -75, -14),
  fixedWingParkingSpot(25, -75, 11.5),
  fixedWingParkingSpot(26, -90, 0),
  fixedWingParkingSpot(27, -90, -11),
  fixedWingParkingSpot(28, -90, 11),
  fixedWingParkingSpot(29, -105, 0),
  fixedWingParkingSpot(30, -105, -11),
  fixedWingParkingSpot(31, -105, 11),
  fixedWingParkingSpot(32, -120, 0),
  fixedWingParkingSpot(33, -120, -11),
  fixedWingParkingSpot(34, -120, 11),
  launchSpot(35, -35, -3, 'deck-run', 'DECK RUN'),
  helicopterParkingSpot('H1', 125, -13),
];

// hms_invincibleRunwaysAndRoutes.lua (HMS Invincible R05 mod).
export const INVINCIBLE_SPOTS: ParkingSpot[] = [
  fixedWingParkingSpot(1, -102, 2.5),
  fixedWingParkingSpot(2, -96, 11.5),
  fixedWingParkingSpot(3, -85, 12),
  fixedWingParkingSpot(4, -72, 12),
  fixedWingParkingSpot(5, -60, 12),
  fixedWingParkingSpot(6, 58, 3),
  launchSpot(7, -88.5, -9.536, 'stovl', 'STOVL 1'),
  helicopterParkingSpot('H1', 45.8, -14.7),
  helicopterParkingSpot('H2', 8, -14.3),
  helicopterParkingSpot('H3', -26.3, -13.9),
  helicopterParkingSpot('H4', -65.4, -13.1),
  helicopterParkingSpot('H5', -93.4, -12.4),
  helicopterParkingSpot('H6', -65.5, 10.9),
  helicopterParkingSpot('H7', -93.6, 10.5),
];

// ara_vdm_RunwaysAndRoutes.lua (ARA Veinticinco de Mayo mod). One catapult;
// the DCS taxi routes stop at (20.6, -11.65) and the game moves the aircraft
// onto the catapult head at (55.621, -8.41), which is the launch spot here.
export const ARA_VDM_SPOTS: ParkingSpot[] = [
  fixedWingParkingSpot(1, -11.576, 13.2),
  fixedWingParkingSpot(2, 2.5, 13.8),
  fixedWingParkingSpot(3, 55, 16.15),
  fixedWingParkingSpot(4, 87.2, 9.6),
  fixedWingParkingSpot(5, 77, 10.5),
  // Port-edge and aft-deck spawn spots.
  fixedWingParkingSpot(6, -2.195, -11.932),
  fixedWingParkingSpot(7, -15.032, -10.423),
  fixedWingParkingSpot(8, -28.628, -9.389),
  fixedWingParkingSpot(9, -42.022, -8.061),
  fixedWingParkingSpot(10, -55.454, -6.095),
  fixedWingParkingSpot(11, -72.392, 5.292),
  launchSpot(12, 55.621, -8.41, 'catapult', 'CAT 1'),
  helicopterParkingSpot('H1', -76.074, 0),
  helicopterParkingSpot('H2', -14.891, -7.568),
  helicopterParkingSpot('H3', 72.633, -2.068),
  helicopterParkingSpot('H4', -51.013, 3.175),
  helicopterParkingSpot('H5', 14.75, -6.607),
  helicopterParkingSpot('H6', 96.349, 0.48),
];
