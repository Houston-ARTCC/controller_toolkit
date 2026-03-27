import { describe, expect, it } from "vitest";
import {
  buildPilotMotionModel,
  buildSectorIndex,
  buildSpecialtySummary,
  buildSplitSummary,
  buildTraconStaffing,
  classifyPosition,
  computeProjectedFlights,
  formatAlt,
  getZhuEnrouteControllers,
} from "./compute";

const sectorsFixture = {
  features: [
    {
      properties: { sector: "zhu" },
      geometry: {
        coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
      },
    },
    {
      properties: { sector: "11", specialty: "N", floor: 0, ceiling: 60000 },
      geometry: {
        coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
      },
    },
    {
      properties: { sector: "22", specialty: "S", floor: 0, ceiling: 60000 },
      geometry: {
        coordinates: [[[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]]],
      },
    },
  ],
};

describe("buildSectorIndex", () => {
  it("extracts features, specialties, and zhu perimeter", () => {
    const index = buildSectorIndex(sectorsFixture);
    expect(index.features).toHaveLength(3);
    expect(index.zhuPerimeter).toHaveLength(5);
    expect(index.specialties).toEqual(["N", "S"]);
  });
});

describe("classifyPosition", () => {
  const index = buildSectorIndex(sectorsFixture);

  it("returns sector properties when inside polygon and altitude bounds", () => {
    const hit = classifyPosition(0.5, 0.5, 15000, index, true);
    expect(hit?.sector).toBe("11");
    expect(hit?.specialty).toBe("N");
  });

  it("returns null when outside polygons", () => {
    const miss = classifyPosition(3, 3, 15000, index, true);
    expect(miss).toBeNull();
  });
});

describe("computeProjectedFlights", () => {
  const index = buildSectorIndex(sectorsFixture);

  it("filters invalid flights and returns projected summary fields", () => {
    const vatsim = {
      pilots: [
        {
          cid: 1,
          callsign: "ZULU2",
          latitude: 0.5,
          longitude: 0.5,
          altitude: 12000,
          groundspeed: 230,
          heading: 90,
          flight_plan: { departure: "KIAH", arrival: "KDFW", aircraft_short: "B738", route: "DCT" },
        },
        {
          cid: 2,
          callsign: "ALPHA1",
          latitude: 1.5,
          longitude: 1.5,
          altitude: 12000,
          groundspeed: 210,
          heading: 270,
          flight_plan: { departure: "KIAH", arrival: "KATL", aircraft_short: "A320", route: "J2" },
        },
        {
          cid: 3,
          callsign: "TOOLOW",
          latitude: 0.5,
          longitude: 0.5,
          altitude: 12000,
          groundspeed: 10,
          heading: 90,
          flight_plan: { departure: "KIAH", arrival: "KAUS", route: "DCT" },
        },
      ],
    };

    const flights = computeProjectedFlights(vatsim, index);
    expect(flights).toHaveLength(2);
    for (const flight of flights) {
      expect(flight).toHaveProperty("altitude");
      expect(flight).toHaveProperty("specialty");
      expect(flight).toHaveProperty("callsign");
      expect(flight).toHaveProperty("proj10Specialty");
      expect(flight).toHaveProperty("proj30Sector");
      expect(flight).not.toHaveProperty("filedRoute");
    }
  });
});

describe("summary builders", () => {
  const projections = [
    {
      altitude: 12000,
      specialty: "N",
      proj10Specialty: "N",
      proj20Specialty: "S",
      proj30Specialty: "S",
      sector: "11",
      proj10Sector: "11",
      proj20Sector: "22",
      proj30Sector: "22",
    },
    {
      altitude: 9000,
      specialty: "S",
      proj10Specialty: "S",
      proj20Specialty: "S",
      proj30Specialty: "S",
      sector: "22",
      proj10Sector: "22",
      proj20Sector: "22",
      proj30Sector: "22",
    },
  ];

  it("buildSpecialtySummary excludes only very low altitude flights", () => {
    const result = buildSpecialtySummary(projections, ["N", "S"]);
    expect(result).toEqual([
      { specialty: "N", now: 1, p10: 1, p20: 0, p30: 0 },
      { specialty: "S", now: 1, p10: 1, p20: 2, p30: 2 },
    ]);
  });

  it("buildSplitSummary counts by split sectors", () => {
    const result = buildSplitSummary(projections, {
      northSplit: ["11"],
      southSplit: ["22"],
    });

    expect(result).toEqual([
      { name: "northSplit", now: 1, p10: 1, p20: 0, p30: 0 },
      { name: "southSplit", now: 1, p10: 1, p20: 2, p30: 2 },
    ]);
  });

  it("counts projected buckets using projected altitude thresholds", () => {
    const altitudeAware = [
      {
        altitude: 9000,
        specialty: "N",
        proj10Specialty: "N",
        proj20Specialty: "N",
        proj30Specialty: "N",
        sector: "11",
        proj10Sector: "11",
        proj20Sector: "11",
        proj30Sector: "11",
        proj10Altitude: 9500,
        proj20Altitude: 10000,
        proj30Altitude: 11500,
      },
    ];

    const specialty = buildSpecialtySummary(altitudeAware, ["N"]);
    const split = buildSplitSummary(altitudeAware, { northSplit: ["11"] });

    expect(specialty).toEqual([{ specialty: "N", now: 1, p10: 1, p20: 1, p30: 1 }]);
    expect(split).toEqual([{ name: "northSplit", now: 1, p10: 1, p20: 1, p30: 1 }]);
  });
});

describe("motion model", () => {
  it("derives rates from snapshots and preserves filed target altitude", () => {
    const previous = buildPilotMotionModel({
      pilots: [
        {
          callsign: "TEST1",
          latitude: 29.9,
          longitude: -95.3,
          altitude: 5000,
          groundspeed: 210,
          heading: 90,
          last_updated: "2026-03-22T20:00:00Z",
          flight_plan: { altitude: "12000" },
        },
      ],
    });

    const next = buildPilotMotionModel(
      {
        pilots: [
          {
            callsign: "TEST1",
            latitude: 29.95,
            longitude: -95.2,
            altitude: 6200,
            groundspeed: 220,
            heading: 96,
            last_updated: "2026-03-22T20:01:00Z",
            flight_plan: { altitude: "12000" },
          },
        ],
      },
      previous,
    );

    expect(next.TEST1).toBeTruthy();
    expect(next.TEST1.targetAltitudeFt).toBe(12000);
    expect(next.TEST1.verticalRateFpm).toBeGreaterThan(0);
    expect(next.TEST1.turnRateDegPerSec).toBeGreaterThan(0);
  });

  it("includes far flights inbound to configured internal airports for enhanced modeling", () => {
    const index = buildSectorIndex(sectorsFixture);
    const model = buildPilotMotionModel(
      {
        pilots: [
          {
            callsign: "INBOUND1",
            latitude: 45,
            longitude: -130,
            altitude: 32000,
            groundspeed: 430,
            heading: 120,
            last_updated: "2026-03-22T20:05:00Z",
            flight_plan: { arrival: "IAH", altitude: "35000" },
          },
          {
            callsign: "OUTSIDE1",
            latitude: 45,
            longitude: -130,
            altitude: 32000,
            groundspeed: 430,
            heading: 120,
            last_updated: "2026-03-22T20:05:00Z",
            flight_plan: { arrival: "KSEA", altitude: "35000" },
          },
          {
            callsign: "FAAID1",
            latitude: 45,
            longitude: -130,
            altitude: 12000,
            groundspeed: 220,
            heading: 200,
            last_updated: "2026-03-22T20:05:00Z",
            flight_plan: { arrival: "1R8", altitude: "12000" },
          },
        ],
      },
      {},
      index,
    );

    expect(model.INBOUND1).toBeTruthy();
    expect(model.OUTSIDE1).toBeUndefined();
    expect(model.FAAID1).toBeTruthy();
  });
});

describe("helpers", () => {
  it("formats altitude to nearest 500 with commas", () => {
    expect(formatAlt(12345)).toBe("12,500");
    expect(formatAlt(NaN)).toBe("-");
  });

  it("filters enroute ZHU controllers by callsign pattern", () => {
    const vatsim = {
      controllers: [
        { callsign: "HOU_11_CTR", cid: 1 },
        { callsign: "HOU_111_CTR", cid: 4 },
        { callsign: "HOU_APP", cid: 2 },
        { callsign: "HOU_22_CTR", cid: 3 },
      ],
    };

    const result = getZhuEnrouteControllers(vatsim);
    expect(result.map((ctrl) => ctrl.callsign)).toEqual(["HOU_11_CTR", "HOU_111_CTR", "HOU_22_CTR"]);
  });

  it("builds tracon staffing status from known callsign patterns", () => {
    const vatsim = {
      controllers: [
        { callsign: "I90_1_APP", cid: 1 },
        { callsign: "AUS_2_APP", cid: 2 },
        { callsign: "SAT_1_APP", cid: 3 },
        { callsign: "LCH_3_DEP", cid: 4 },
      ],
    };

    const result = buildTraconStaffing(vatsim);
    const find = (id) => result.find((item) => item.id === id);

    expect(find("I90")?.staffed).toBe(true);
    expect(find("AUS")?.staffed).toBe(true);
    expect(find("SAT")?.staffed).toBe(true);
    expect(find("LCH")?.staffed).toBe(true);
    expect(find("VLY")?.staffed).toBe(false);
    expect(find("CRP")?.staffed).toBe(false);
  });
});
