/**
 * Generates a realistic on-device-format sample at samples/Timeline.sample.json
 * for manually exercising the UI. Run with: npm run sample
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "samples");
mkdirSync(outDir, { recursive: true });

const HOME = { lat: 37.5512, lng: 126.9882 };
const OFFICE = { lat: 37.4979, lng: 127.0276 };
const CAFE = { lat: 37.5665, lng: 126.978 };
const GYM = { lat: 37.5443, lng: 127.0557 };

const PLACES = [
  { name: "집", ...HOME, weight: 5 },
  { name: "판교 오피스", ...OFFICE, weight: 4 },
  { name: "성수 단골 카페", ...CAFE, weight: 3 },
  { name: "동네 헬스장", ...GYM, weight: 2 },
];

const MODES = [
  { type: "in_passenger_vehicle", perTrip: 14_000 },
  { type: "walking", perTrip: 1_800 },
  { type: "in_subway", perTrip: 9_500 },
  { type: "cycling", perTrip: 4_200 },
];

const iso = (d: Date) => d.toISOString();
const jitter = (v: number, amount: number) => v + (Math.random() - 0.5) * amount;

type Segment = Record<string, unknown>;
const segments: Segment[] = [];

const start = new Date("2025-01-01T00:00:00Z");

for (let day = 0; day < 300; day++) {
  const dayStart = new Date(start.getTime() + day * 86_400_000);

  // Morning commute with a traced path
  const commuteStart = new Date(dayStart.getTime() + 8 * 3_600_000);
  const commuteEnd = new Date(commuteStart.getTime() + 45 * 60_000);
  const steps = 12;
  const path = Array.from({ length: steps }, (_, i) => {
    const t = i / (steps - 1);
    return {
      point: `${jitter(HOME.lat + (OFFICE.lat - HOME.lat) * t, 0.004).toFixed(6)}°, ${jitter(
        HOME.lng + (OFFICE.lng - HOME.lng) * t,
        0.004
      ).toFixed(6)}°`,
      time: iso(new Date(commuteStart.getTime() + t * 45 * 60_000)),
    };
  });

  segments.push({
    startTime: iso(commuteStart),
    endTime: iso(commuteEnd),
    timelinePath: path,
  });

  const mode = MODES[day % MODES.length];
  segments.push({
    startTime: iso(commuteStart),
    endTime: iso(commuteEnd),
    activity: {
      distanceMeters: Math.round(jitter(mode.perTrip, mode.perTrip * 0.3)),
      topCandidate: { type: mode.type },
      start: { latLng: `${HOME.lat}°, ${HOME.lng}°` },
      end: { latLng: `${OFFICE.lat}°, ${OFFICE.lng}°` },
    },
  });

  // A couple of visits per day, weighted so Top 3 is stable
  const pool = PLACES.flatMap((p) => Array<typeof p>(p.weight).fill(p));
  for (let v = 0; v < 2; v++) {
    const place = pool[Math.floor(Math.random() * pool.length)];
    const visitStart = new Date(dayStart.getTime() + (10 + v * 5) * 3_600_000);
    segments.push({
      startTime: iso(visitStart),
      endTime: iso(new Date(visitStart.getTime() + 2 * 3_600_000)),
      visit: {
        topCandidate: {
          placeLocation: {
            latLng: `${jitter(place.lat, 0.0008).toFixed(6)}°, ${jitter(
              place.lng,
              0.0008
            ).toFixed(6)}°`,
          },
          name: place.name,
          semanticType: place.name === "집" ? "INFERRED_HOME" : "SEARCHED_ADDRESS",
        },
      },
    });
  }
}

const outFile = join(outDir, "Timeline.sample.json");
writeFileSync(outFile, JSON.stringify({ semanticSegments: segments }));
console.log(`wrote ${outFile} (${segments.length} segments)`);
