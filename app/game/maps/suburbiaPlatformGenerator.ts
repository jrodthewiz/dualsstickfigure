import { SUBURBAN_HOUSE_CONFIG } from "./suburbia";

export const SUBURBIA_CHUNK_SPACING = 520;

type HoverMotionKind = "none" | "horizontal" | "pulse";

interface SuburbiaRowDefinition {
  id: number;
  lane: number;
  kind: "ground" | "hover";
  altitude: number; // Distance above ground for platform top (0 = ground)
  altitudeJitter: number;
  spawnChance: number;
  motion: HoverMotionKind;
  thrusters: boolean;
  minGap: number;
  amplitudeRange?: [number, number];
  speedRange?: [number, number];
}

interface SuburbiaRowHouseSettings {
  widthRange: [number, number];
  height: number;
  buddyChance?: number;
  buddyWidthRange?: [number, number];
  buddyGap?: number;
}

const GROUND_ROW_SETTINGS: SuburbiaRowHouseSettings = {
  widthRange: [340, 410],
  height: 260,
  buddyChance: 0.45,
  buddyWidthRange: [220, 260],
  buddyGap: 110,
};

const HOVER_ROW_SETTINGS: SuburbiaRowHouseSettings = {
  widthRange: [320, 380],
  height: 230,
};

const ROW_DEFINITIONS: SuburbiaRowDefinition[] = [
  {
    id: 0,
    lane: 0,
    kind: "ground",
    altitude: 0,
    altitudeJitter: 18,
    spawnChance: 1,
    motion: "none",
    thrusters: false,
    minGap: 140,
  },
  {
    id: 1,
    lane: 1,
    kind: "hover",
    altitude: 260,
    altitudeJitter: 60,
    spawnChance: 0.92,
    motion: "horizontal",
    thrusters: true,
    minGap: 120,
    amplitudeRange: [55, 105],
    speedRange: [0.35, 0.6],
  },
  {
    id: 2,
    lane: 2,
    kind: "hover",
    altitude: 420,
    altitudeJitter: 70,
    spawnChance: 0.78,
    motion: "pulse",
    thrusters: true,
    minGap: 120,
    amplitudeRange: [18, 28],
    speedRange: [0.55, 0.85],
  },
  {
    id: 3,
    lane: 3,
    kind: "hover",
    altitude: 620,
    altitudeJitter: 90,
    spawnChance: 0.65,
    motion: "horizontal",
    thrusters: true,
    minGap: 140,
    amplitudeRange: [100, 150],
    speedRange: [0.4, 0.65],
  },
];

export type SuburbiaPlatformKind = "ground" | "hover";

export interface SuburbiaPlatformDescriptor {
  chunk: number;
  chunkId: number;
  id: number;
  kind: SuburbiaPlatformKind;
  lane: number;
  x: number;
  y: number;
  width: number;
  height: number;
  thrusters: boolean;
  styleVariant: number;
  seed: number;
  motion?: {
    axis: "x" | "y";
    amplitude: number;
    speed: number;
    phase: number;
  };
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const pickInRange = (
  seededRand: (seed: number, offset: number) => number,
  seed: number,
  offset: number,
  [min, max]: [number, number]
) => lerp(min, max, seededRand(seed, offset));

const groundHeight = () => SUBURBAN_HOUSE_CONFIG.HEIGHT;

const hoverHeight = () => 230;

export interface GenerateSuburbiaPlatformsParams {
  minChunk: number;
  maxChunk: number;
  groundYAt: (xWorld: number) => number;
  seededRand: (seed: number, offset: number) => number;
}

export function generateSuburbiaPlatforms(
  params: GenerateSuburbiaPlatformsParams
): SuburbiaPlatformDescriptor[] {
  const { minChunk, maxChunk, groundYAt, seededRand } = params;
  const descriptors: SuburbiaPlatformDescriptor[] = [];

  for (let chunk = minChunk; chunk <= maxChunk; chunk++) {
    const baseX = chunk * SUBURBIA_CHUNK_SPACING;
    const chunkSeed = chunk * 971 + 37;
    const chunkSeedFloat = chunk + 0.125;
    const rowBaseGround = groundYAt(baseX);

    for (const row of ROW_DEFINITIONS) {
      const spawnRoll = seededRand(chunkSeed, 100 + row.id);
      if (spawnRoll > row.spawnChance) continue;

      const centerJitter = (seededRand(chunkSeed, 110 + row.id) - 0.5) * 80;
      const platformCenterX = baseX + centerJitter;

      const styleVariantSeed = Math.floor(
        seededRand(chunkSeed, 120 + row.id) * 4
      );

      const widthRange =
        row.kind === "ground"
          ? GROUND_ROW_SETTINGS.widthRange
          : HOVER_ROW_SETTINGS.widthRange;
      const height =
        row.kind === "ground" ? groundHeight() : hoverHeight();

      const width = pickInRange(
        seededRand,
        chunkSeed,
        130 + row.id,
        widthRange
      );

      const altitude =
        row.kind === "ground"
          ? 0
          : row.altitude +
            (seededRand(chunkSeed, 140 + row.id) - 0.5) * row.altitudeJitter;

      const platformTopY = row.kind === "ground"
        ? rowBaseGround - height
        : rowBaseGround - altitude;

      const idBase = chunk * 100 + row.id * 10;
      const chunkId = idBase + 1;

      descriptors.push({
        chunk,
        chunkId,
        id: idBase + 1,
        kind: row.kind,
        lane: row.lane,
        x: platformCenterX - width / 2,
        y: platformTopY,
        width,
        height,
        thrusters: row.thrusters,
        styleVariant: styleVariantSeed,
        seed: chunkSeedFloat + row.id * 0.1,
        motion:
          row.motion === "horizontal"
            ? {
                axis: "x",
                amplitude: row.amplitudeRange
                  ? pickInRange(
                      seededRand,
                      chunkSeed,
                      150 + row.id,
                      row.amplitudeRange
                    )
                  : 0,
                speed: row.speedRange
                  ? pickInRange(
                      seededRand,
                      chunkSeed,
                      160 + row.id,
                      row.speedRange
                    )
                  : 0.4,
                phase: seededRand(chunkSeed, 170 + row.id) * Math.PI * 2,
              }
            : row.motion === "pulse"
            ? {
                axis: "y",
                amplitude: row.amplitudeRange
                  ? pickInRange(
                      seededRand,
                      chunkSeed,
                      150 + row.id,
                      row.amplitudeRange
                    )
                  : 20,
                speed: row.speedRange
                  ? pickInRange(
                      seededRand,
                      chunkSeed,
                      160 + row.id,
                      row.speedRange
                    )
                  : 0.65,
                phase: seededRand(chunkSeed, 170 + row.id) * Math.PI * 2,
              }
            : undefined,
      });

      if (
        row.kind === "ground" &&
        GROUND_ROW_SETTINGS.buddyChance &&
        seededRand(chunkSeed, 180 + row.id) < GROUND_ROW_SETTINGS.buddyChance
      ) {
        const buddyWidth = pickInRange(
          seededRand,
          chunkSeed,
          181 + row.id,
          GROUND_ROW_SETTINGS.buddyWidthRange!
        );
        const buddyGap = GROUND_ROW_SETTINGS.buddyGap ?? 110;
        const buddySign = seededRand(chunkSeed, 182 + row.id) > 0.5 ? 1 : -1;
        const buddyCenter = platformCenterX + buddySign * (width / 2 + buddyGap + buddyWidth / 2);

        descriptors.push({
          chunk,
          chunkId: idBase + 2,
          id: idBase + 2,
          kind: "ground",
          lane: row.lane,
          x: buddyCenter - buddyWidth / 2,
          y: platformTopY + clamp(seededRand(chunkSeed, 183 + row.id) * 16, 0, 16),
          width: buddyWidth,
          height,
          thrusters: false,
          styleVariant: (styleVariantSeed + 1) % 4,
          seed: chunkSeedFloat + row.id * 0.1 + 0.05,
        });
      }
    }
  }

  return descriptors;
}
