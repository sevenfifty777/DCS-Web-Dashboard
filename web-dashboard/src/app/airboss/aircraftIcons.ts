export interface AircraftIconSpec {
  fileName: string;
  lengthMeters: number;
}

interface AircraftIconDefinition {
  aliases: string[];
  parkedFileName: string;
  catapultFileName?: string;
  lengthMeters: number;
}

const AIRCRAFT_ICON_DEFINITIONS: AircraftIconDefinition[] = [
  {
    aliases: ['f-14'],
    parkedFileName: 'f-14_icon_park.png',
    catapultFileName: 'f-14_icon_cat.png',
    lengthMeters: 19.1,
  },
  {
    aliases: ['fa-18', 'f/a-18', 'f-18', 'hornet'],
    parkedFileName: 'F-18_icon_park.png',
    catapultFileName: 'F-18_icon_cat.png',
    lengthMeters: 17.1,
  },
  {
    aliases: ['av8', 'av-8', 'harrier'],
    parkedFileName: 'AV88_icon.park.png',
    lengthMeters: 14.1,
  },
  {
    aliases: ['a-4e-c', 'a4e-c', 'a-4'],
    parkedFileName: 'A-4E-C_icon_park.png',
    lengthMeters: 12.2,
  },
  {
    aliases: ['a-6e', 'a6e'],
    parkedFileName: 'A-6E_icon_park.png',
    lengthMeters: 16.7,
  },
  {
    aliases: ['e-2d', 'e2d', 'e-2c', 'e2c', 'hawkeye'],
    parkedFileName: 'E-2D_icon_park.png',
    catapultFileName: 'E-2D_icon_cat.png',
    lengthMeters: 17.6,
  },
  {
    aliases: ['s-3b', 's3b', 'viking'],
    parkedFileName: 'S-3B_icon_park.png',
    catapultFileName: 'S-3B_icon_cat.png',
    lengthMeters: 16.3,
  },
  {
    aliases: ['ah-64d', 'apache'],
    parkedFileName: 'ah-64d_icon_park.png',
    lengthMeters: 17.7,
  },
  {
    aliases: ['ch-47f', 'ch47f', 'chinook'],
    parkedFileName: 'CH-47F_icon_park.png',
    lengthMeters: 30.2,
  },
  {
    aliases: ['ka-50', 'ka50', 'black shark'],
    parkedFileName: 'Ka-50_3_icon_park.png',
    lengthMeters: 16,
  },
  {
    aliases: ['oh58d', 'oh-58d', 'kiowa'],
    parkedFileName: 'oh58d_icon_park.png',
    lengthMeters: 12.9,
  },
  {
    aliases: ['sa342', 'sa-342', 'gazelle'],
    parkedFileName: 'sa342_icon_park.png',
    lengthMeters: 12,
  },
  {
    aliases: ['uh-1h', 'uh1h', 'huey'],
    parkedFileName: 'UH-1H_icon_park.png',
    lengthMeters: 17.4,
  },
  {
    aliases: ['t-45', 't45c', 'goshawk'],
    parkedFileName: 'T45C_icon_park.png',
    lengthMeters: 12,
  },
];

export const AIRCRAFT_ICON_FILES = Array.from(new Set(
  AIRCRAFT_ICON_DEFINITIONS.flatMap((definition) => [
    definition.parkedFileName,
    ...(definition.catapultFileName ? [definition.catapultFileName] : []),
  ]),
));

export function aircraftIconForType(
  aircraftType: string | undefined,
  useCatapultVariant = false,
): AircraftIconSpec | null {
  const normalizedType = aircraftType?.trim().toLowerCase() ?? '';
  const definition = AIRCRAFT_ICON_DEFINITIONS.find(({ aliases }) =>
    aliases.some((alias) => normalizedType.includes(alias))
  );
  if (!definition) return null;

  return {
    fileName: useCatapultVariant && definition.catapultFileName
      ? definition.catapultFileName
      : definition.parkedFileName,
    lengthMeters: definition.lengthMeters,
  };
}
