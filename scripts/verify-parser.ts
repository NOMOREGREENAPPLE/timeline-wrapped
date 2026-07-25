/**
 * Sanity check for the three supported Google Timeline formats.
 * Run with: npm run verify:parser
 */
import assert from "node:assert/strict";
import { aggregateBundle, parseTimelineJson } from "../src/lib/parser.ts";

const results: string[] = [];

function parse(raw: unknown) {
  return aggregateBundle(parseTimelineJson(raw));
}

function check(name: string, fn: () => void) {
  try {
    fn();
    results.push(`PASS  ${name}`);
  } catch (err) {
    results.push(`FAIL  ${name}\n      ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

// ── Format 1: on-device backup (semanticSegments / timelinePath) ──────
const onDevice = {
  semanticSegments: [
    {
      startTime: "2024-03-01T09:00:00.000+09:00",
      endTime: "2024-03-01T09:30:00.000+09:00",
      timelinePath: [
        { point: "37.566535°, 126.977969°", time: "2024-03-01T09:00:00.000+09:00" },
        { point: "37.579617°, 126.977041°", time: "2024-03-01T09:15:00.000+09:00" },
        { point: "37.588000°, 126.994000°", time: "2024-03-01T09:30:00.000+09:00" },
      ],
    },
    {
      startTime: "2024-03-01T10:00:00.000+09:00",
      endTime: "2024-03-01T18:00:00.000+09:00",
      visit: {
        topCandidate: {
          placeLocation: { latLng: "37.551169°, 126.988227°" },
          semanticType: "INFERRED_HOME",
          placeId: "ChIJhome",
        },
      },
    },
    {
      startTime: "2024-03-02T08:00:00.000+09:00",
      endTime: "2024-03-02T08:45:00.000+09:00",
      activity: {
        distanceMeters: 12400,
        topCandidate: { type: "in_passenger_vehicle" },
        start: { latLng: "37.551169°, 126.988227°" },
        end: { latLng: "37.497942°, 127.027621°" },
      },
    },
  ],
};

check("format 1 — semanticSegments", () => {
  const d = parse(onDevice);
  assert.ok(d.coordinates.length >= 5, `coords=${d.coordinates.length}`);
  assert.ok(
    d.coordinates.every(
      (c) => c.lat > 37 && c.lat < 38 && c.lng > 126 && c.lng < 128
    ),
    "coordinates out of expected Seoul range"
  );
  assert.equal(d.topPlaces[0]?.name, "집");
  assert.ok(
    d.activities.some((a) => a.type === "자동차" && a.distanceMeters === 12400),
    JSON.stringify(d.activities)
  );
  assert.ok(d.totalDistanceKm >= 12.4, `distance=${d.totalDistanceKm}`);
  assert.equal(d.dateRange.start.getFullYear(), 2024);
  assert.ok(d.dateRange.end > d.dateRange.start);
});

// ── Format 2: classic Takeout (timelineObjects) ───────────────────────
const takeout = {
  timelineObjects: [
    {
      placeVisit: {
        location: {
          latitudeE7: 375665350,
          longitudeE7: 1269779690,
          name: "경복궁",
          placeId: "ChIJgyeongbok",
        },
        duration: {
          startTimestampMs: "1709251200000",
          endTimestampMs: "1709258400000",
        },
      },
    },
    {
      placeVisit: {
        location: { latitudeE7: 375665350, longitudeE7: 1269779690, name: "경복궁" },
        duration: {
          startTimestamp: "2024-03-05T02:00:00Z",
          endTimestamp: "2024-03-05T04:00:00Z",
        },
      },
    },
    {
      activitySegment: {
        startLocation: { latitudeE7: 375665350, longitudeE7: 1269779690 },
        endLocation: { latitudeE7: 374979420, longitudeE7: 1270276210 },
        distance: 8700,
        activityType: "WALKING",
        duration: {
          startTimestamp: "2024-03-06T00:00:00Z",
          endTimestamp: "2024-03-06T01:30:00Z",
        },
        waypointPath: {
          waypoints: [
            { latE7: 375600000, lngE7: 1269900000 },
            { latE7: 375200000, lngE7: 1270100000 },
          ],
        },
      },
    },
  ],
};

check("format 2 — timelineObjects (E7)", () => {
  const d = parse(takeout);
  const gyeongbok = d.coordinates[0];
  assert.ok(
    Math.abs(gyeongbok.lat - 37.566535) < 1e-6,
    `E7 not normalized: ${gyeongbok.lat}`
  );
  assert.ok(Math.abs(gyeongbok.lng - 126.977969) < 1e-6);
  assert.equal(d.topPlaces[0]?.name, "경복궁");
  assert.equal(d.topPlaces[0]?.visitCount, 2);
  const walk = d.activities.find((a) => a.type === "도보");
  assert.ok(walk, "walking activity missing");
  assert.equal(walk!.distanceMeters, 8700);
  assert.equal(walk!.durationMinutes, 90);
  assert.equal(d.totalDistanceKm, 8.7);
});

// ── Format 3: legacy Records.json (locations[]) ───────────────────────
const legacy = {
  locations: [
    {
      timestampMs: "1709251200000",
      latitudeE7: 375665350,
      longitudeE7: 1269779690,
      accuracy: 20,
      activity: [
        {
          timestampMs: "1709251200000",
          activity: [
            { type: "ON_FOOT", confidence: 80 },
            { type: "STILL", confidence: 15 },
          ],
        },
      ],
    },
    // Low-accuracy fix that would otherwise add a bogus 200km hop
    {
      timestampMs: "1709251500000",
      latitudeE7: 355000000,
      longitudeE7: 1290000000,
      accuracy: 3000,
    },
    {
      timestampMs: "1709252100000",
      latitudeE7: 375796170,
      longitudeE7: 1269770410,
      accuracy: 15,
      activity: [
        { timestampMs: "1709252100000", activity: [{ type: "IN_VEHICLE", confidence: 90 }] },
      ],
    },
    // Sub-15m jitter — should not accumulate distance
    {
      timestampMs: "1709252160000",
      latitudeE7: 375796200,
      longitudeE7: 1269770450,
      accuracy: 15,
    },
  ],
};

check("format 3 — legacy locations[]", () => {
  const d = parse(legacy);
  assert.equal(d.coordinates.length, 3, "low-accuracy point should be dropped");
  assert.ok(Math.abs(d.coordinates[0].lat - 37.566535) < 1e-6);
  assert.ok(
    d.totalDistanceKm > 1 && d.totalDistanceKm < 3,
    `noise leaked into distance: ${d.totalDistanceKm}km`
  );
  assert.ok(d.activities.some((a) => a.type === "도보"));
  assert.ok(d.activities.some((a) => a.type === "자동차"));
  assert.ok(!d.activities.some((a) => a.type === "정지"), "STILL should be filtered");
});

// ── E7 near the equator (small integers must still divide by 1e7) ─────
check("E7 fields near equator are not mistaken for decimals", () => {
  const d = parse({
    timelineObjects: [
      {
        placeVisit: {
          location: { latitudeE7: 1500000, longitudeE7: 1200000, name: "적도 근처" },
          duration: { startTimestamp: "2024-01-01T00:00:00Z" },
        },
      },
    ],
  });
  const c = d.coordinates[0];
  assert.ok(Math.abs(c.lat - 0.15) < 1e-9, `lat=${c.lat}`);
  assert.ok(Math.abs(c.lng - 0.12) < 1e-9, `lng=${c.lng}`);
});

check("date range filter slices visits and distance", () => {
  const bundle = parseTimelineJson(onDevice);
  const march1 = aggregateBundle(bundle, {
    start: new Date(2024, 2, 1),
    end: new Date(2024, 2, 1),
  });
  const march2 = aggregateBundle(bundle, {
    start: new Date(2024, 2, 2),
    end: new Date(2024, 2, 2),
  });
  assert.equal(march1.topPlaces[0]?.name, "집");
  assert.ok(
    !march2.topPlaces.some((p) => p.name === "집"),
    "home visit should be excluded on March 2"
  );
  assert.ok(
    march2.activities.some((a) => a.type === "자동차"),
    "car trip is on March 2"
  );
  assert.ok(march2.totalDistanceKm >= 12.4);
  assert.ok(march1.totalDistanceKm < march2.totalDistanceKm || march1.totalDistanceKm >= 0);
});

check("large coordinate sets do not overflow the call stack", () => {
  const start = Date.UTC(2024, 0, 1);
  const points = Array.from({ length: 250_000 }, (_, index) => ({
    lat: 37.5 + (index % 100) / 100_000,
    lng: 127 + (index % 100) / 100_000,
    t: start + index * 1_000,
  }));
  const data = aggregateBundle({
    points,
    visits: [],
    activities: [],
    hops: [],
    dateRange: {
      start: new Date(points[0].t),
      end: new Date(points[points.length - 1].t),
    },
  });
  assert.equal(data.coordinates.length, points.length);
  assert.equal(data.dateRange.start.getTime(), points[0].t);
  assert.equal(data.dateRange.end.getTime(), points[points.length - 1].t);
});

// ── Error handling ────────────────────────────────────────────────────
check("rejects unknown shape", () => {
  assert.throws(() => parseTimelineJson({ foo: "bar" }), /지원하지 않는/);
});

check("rejects non-object root", () => {
  assert.throws(() => parseTimelineJson([1, 2, 3]), /객체가 아닙니다/);
});

check("rejects empty timeline", () => {
  assert.throws(() => parseTimelineJson({ locations: [] }), /찾을 수 없습니다/);
});

console.log(results.join("\n"));
console.log(
  process.exitCode === 1 ? "\n일부 검증 실패" : "\n모든 파서 검증 통과"
);
