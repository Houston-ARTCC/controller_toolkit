"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const VATSIM_DATA_URL = "https://data.vatsim.net/v3/vatsim-data.json";
const KIAH_ATIS_URL = "https://atis.info/api/KIAH";
const REFRESH_MS = 60_000;
const ATIS_REFRESH_MS = 30 * 60_000;

function normalizeAirport(code) {
  const cleaned = (code || "").trim().toUpperCase();
  if (!cleaned) {
    return "";
  }

  // Preserve full ICAO identifiers (e.g. MHPR, CYYZ). Only expand 3-letter
  // domestic-style codes (e.g. IAH -> KIAH) for alias matching convenience.
  if (cleaned.length === 4 || cleaned.length === 5) {
    return cleaned;
  }

  if (cleaned.length === 3 && /^[A-Z0-9]{3}$/.test(cleaned)) {
    return cleaned.startsWith("K") ? cleaned : `K${cleaned}`;
  }

  return cleaned;
}

function normalizeRouteString(value) {
  return (value || "").toUpperCase().replace(/[^A-Z0-9#\/\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenizeFiledRoute(value) {
  const cleaned = normalizeRouteString(value);
  return cleaned ? cleaned.split(" ") : [];
}

function parsePreferredToken(token) {
  const cleaned = token.replace(/#/g, "").trim();
  if (!cleaned) {
    return [];
  }

  if (/^(TBD|DCT|DIRECT)$/i.test(cleaned)) {
    return [];
  }

  if (/^FL?\d+$/i.test(cleaned)) {
    return [];
  }

  return cleaned.split("/").map((part) => part.trim()).filter(Boolean);
}

function stripProcedureRevision(token) {
  const match = token.match(/^([A-Z]{4,6})(\d{1,2})$/);
  if (!match) {
    return "";
  }

  return match[1];
}

function tokensMatch(filedToken, preferredOption, allowRevisionMatch) {
  const filed = filedToken.replace(/#/g, "");
  const preferred = preferredOption.replace(/#/g, "");

  if (filed === preferred) {
    return true;
  }

  if (!allowRevisionMatch) {
    return false;
  }

  const filedBase = stripProcedureRevision(filed);
  const preferredBase = stripProcedureRevision(preferred);
  return Boolean(filedBase && preferredBase && filedBase === preferredBase);
}

function matchPreferredRoute(filedTokens, preferredRoute, allowRevisionMatch = false) {
  const preferredTokens = normalizeRouteString(preferredRoute)
    .split(" ")
    .map(parsePreferredToken)
    .filter((options) => options.length > 0);

  if (preferredTokens.length === 0) {
    return { matched: false, ratio: 0 };
  }

  let searchStart = 0;
  let matchedCount = 0;

  for (const options of preferredTokens) {
    let foundIndex = -1;
    for (let index = searchStart; index < filedTokens.length; index += 1) {
      if (options.some((option) => tokensMatch(filedTokens[index], option, allowRevisionMatch))) {
        foundIndex = index;
        break;
      }
    }

    if (foundIndex >= 0) {
      matchedCount += 1;
      searchStart = foundIndex + 1;
    }
  }

  const ratio = matchedCount / preferredTokens.length;
  return {
    matched: ratio === 1,
    ratio,
  };
}

function getFirstRouteTokenOptions(routeText) {
  const tokens = normalizeRouteString(routeText).split(" ");
  for (const token of tokens) {
    const options = parsePreferredToken(token);
    if (options.length > 0) {
      return options.map((option) => option.replace(/#/g, ""));
    }
  }
  return [];
}

function classifyMatch(bestRatio, hasExact, hasRevisionMatch, hasRule, hasFlowMismatch = false) {
  if (!hasRule) {
    return { label: "No Rule", tone: "neutral" };
  }

  if (hasFlowMismatch) {
    return { label: "FLOW", tone: "bad" };
  }

  if (hasExact) {
    return { label: "Match", tone: "good" };
  }

  if (hasRevisionMatch) {
    return { label: "Revision", tone: "revision" };
  }

  if (bestRatio >= 0.67) {
    return { label: "Close", tone: "warn" };
  }

  return { label: "Mismatch", tone: "bad" };
}

function detectKiahFlowFromAtis(datisText) {
  const upper = (datisText || "").toUpperCase();
  if (!upper) {
    return "Unknown";
  }

  const arrivalsSlice = upper.includes("ARRIVALS EXPECT")
    ? upper.split("ARRIVALS EXPECT")[1]?.split("DEPG")[0] || ""
    : upper;

  const runwayMatches = arrivalsSlice.match(/\b(?:RY|RWY|RUNWAY)\s*(\d{1,2})(?:[LRC])?\b/g) || [];
  const runwayNumbers = runwayMatches
    .map((item) => {
      const match = item.match(/(\d{1,2})/);
      return match ? Number.parseInt(match[1], 10) : NaN;
    })
    .filter((value) => Number.isFinite(value));

  const hasWest = runwayNumbers.some((value) => value === 26 || value === 27);
  const hasEast = runwayNumbers.some((value) => value === 8 || value === 9);

  if (hasWest && !hasEast) {
    return "West";
  }
  if (hasEast && !hasWest) {
    return "East";
  }
  return "Unknown";
}

function expectedKiahFlowFromVariantLabel(label) {
  const upper = (label || "").toUpperCase();
  if (upper.includes("IAHW")) {
    return "West";
  }
  if (upper.includes("IAHE")) {
    return "East";
  }
  return "Any";
}

function isLikelyDeparted(pilot) {
  const altitude = Number.parseInt(pilot?.altitude ?? "0", 10) || 0;
  const groundspeed = Number.parseInt(pilot?.groundspeed ?? "0", 10) || 0;

  // Heuristic: filter aircraft that are likely airborne, while keeping aircraft
  // taxiing or waiting for departure at the field.
  if (altitude >= 1500) {
    return true;
  }

  if (altitude >= 400 && groundspeed >= 100) {
    return true;
  }

  if (groundspeed >= 260) {
    return true;
  }

  return false;
}

function AirportInput({ id, label, value, onChange, airports }) {
  return (
    <label className="space-y-1" htmlFor={id}>
      <span className="text-muted text-xs uppercase tracking-[0.16em]">{label}</span>
      <input
        className="search w-full"
        id={id}
        list="route-validator-airports"
        onChange={(event) => onChange(event.target.value)}
        placeholder="KIAH"
        type="search"
        value={value}
      />
      <datalist id="route-validator-airports">
        {airports.map((airport) => (
          <option key={airport} value={airport} />
        ))}
      </datalist>
    </label>
  );
}

export default function RouteValidatorPage({ routeData }) {
  const [controlledAirportInput, setControlledAirportInput] = useState("KIAH");
  const [arrivalFilterInput, setArrivalFilterInput] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [showDeparted, setShowDeparted] = useState(false);
  const [showPrefiles, setShowPrefiles] = useState(true);
  const [pilots, setPilots] = useState([]);
  const [fetchError, setFetchError] = useState("");
  const [atisError, setAtisError] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");
  const [kiahFlow, setKiahFlow] = useState("Unknown");
  const [kiahAtisCode, setKiahAtisCode] = useState("");
  const [copiedRouteKey, setCopiedRouteKey] = useState("");

  const controlledAirport = normalizeAirport(controlledAirportInput);
  const arrivalFilter = normalizeAirport(arrivalFilterInput);
  const search = searchInput.trim().toUpperCase();

  useEffect(() => {
    let active = true;

    const fetchData = async () => {
      try {
        const response = await fetch(VATSIM_DATA_URL, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Fetch failed with status ${response.status}`);
        }

        const data = await response.json();
        if (!active) {
          return;
        }

        const connectedPilots = (data?.pilots || [])
          .filter((pilot) => pilot?.flight_plan?.departure)
          .map((pilot) => ({
            ...pilot,
            __isPrefile: false,
          }));

        const prefilePilots = (data?.prefiles || [])
          .filter((prefile) => prefile?.flight_plan?.departure)
          .map((prefile) => ({
            ...prefile,
            altitude: 0,
            groundspeed: 0,
            __isPrefile: true,
          }));

        const connectedKeys = new Set(
          connectedPilots.map((pilot) => {
            const flightPlan = pilot.flight_plan || {};
            return `${(pilot.callsign || "").toUpperCase()}|${normalizeAirport(flightPlan.departure)}|${normalizeAirport(
              flightPlan.arrival,
            )}`;
          }),
        );

        const uniquePrefiles = prefilePilots.filter((prefile) => {
          const flightPlan = prefile.flight_plan || {};
          const key = `${(prefile.callsign || "").toUpperCase()}|${normalizeAirport(
            flightPlan.departure,
          )}|${normalizeAirport(flightPlan.arrival)}`;
          return !connectedKeys.has(key);
        });

        const nextPilots = [...connectedPilots, ...uniquePrefiles];
        setPilots(nextPilots);
        setFetchError("");
        setLastUpdated(new Date().toISOString());
      } catch (error) {
        if (!active) {
          return;
        }
        setFetchError(error?.message || "Failed to load VATSIM data feed.");
      }
    };

    fetchData();
    const timer = setInterval(fetchData, REFRESH_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let active = true;

    const fetchKiahAtis = async () => {
      try {
        const response = await fetch(KIAH_ATIS_URL, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`KIAH ATIS fetch failed (${response.status})`);
        }

        const data = await response.json();
        if (!active) {
          return;
        }

        const first = Array.isArray(data) ? data[0] : null;
        const datis = first?.datis || "";
        setKiahFlow(detectKiahFlowFromAtis(datis));
        setKiahAtisCode(first?.code || "");
        setAtisError("");
      } catch (error) {
        if (!active) {
          return;
        }
        setAtisError(error?.message || "Failed to load KIAH D-ATIS.");
        setKiahFlow("Unknown");
      }
    };

    fetchKiahAtis();
    const timer = setInterval(fetchKiahAtis, ATIS_REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const routeMap = useMemo(() => {
    const map = new Map();

    for (const route of routeData.routes || []) {
      const key = `${route.departure}-${route.arrival}`;
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key).push(route);
    }

    return map;
  }, [routeData.routes]);

  const validations = useMemo(() => {
    if (!controlledAirport) {
      return [];
    }

    const filteredPilots = pilots.filter((pilot) => {
      const flightPlan = pilot.flight_plan;
      const departure = normalizeAirport(flightPlan?.departure);
      const arrival = normalizeAirport(flightPlan?.arrival);
      const route = flightPlan?.route || "";
      const callsign = (pilot?.callsign || "").toUpperCase();
      const isPrefile = Boolean(pilot?.__isPrefile);

      if (departure !== controlledAirport) {
        return false;
      }

      if (isPrefile && !showPrefiles) {
        return false;
      }

      if (arrivalFilter && arrival !== arrivalFilter) {
        return false;
      }

      if (!search) {
        return showDeparted ? true : !isLikelyDeparted(pilot);
      }

      const combined = `${callsign} ${arrival} ${route}`.toUpperCase();
      if (!combined.includes(search)) {
        return false;
      }

      return showDeparted ? true : !isLikelyDeparted(pilot);
    });

    return filteredPilots.map((pilot) => {
      const flightPlan = pilot.flight_plan;
      const departure = normalizeAirport(flightPlan.departure);
      const arrival = normalizeAirport(flightPlan.arrival);
      const routeUsesKiahFlow = departure === "KIAH" || arrival === "KIAH";
      const filedRoute = flightPlan.route || "";
      const filedTokens = tokenizeFiledRoute(filedRoute);
      const rules = routeMap.get(`${departure}-${arrival}`) || [];

      let bestRule = null;
      let bestVariant = null;
      let bestRatio = 0;
      let bestRevisionRatio = 0;
      let hasExact = false;
      let hasRevisionMatch = false;
      let bestRevisionRule = null;
      let bestRevisionVariant = null;
      let bestFlowConflict = false;
      let opposingFlowMatched = false;
      let opposingFlowDepartureToken = false;

      for (const rule of rules) {
        const variants = rule.variants || [];

        const preferredVariants = variants.filter((variant) => {
          if (!routeUsesKiahFlow || kiahFlow === "Unknown") {
            return true;
          }

          const expectedFlow = expectedKiahFlowFromVariantLabel(variant.label);
          return expectedFlow === "Any" || expectedFlow === kiahFlow;
        });

        const variantsToEvaluate = preferredVariants.length > 0 ? preferredVariants : variants;

        for (const variant of variantsToEvaluate) {
          const exactResult = matchPreferredRoute(filedTokens, variant.route, false);
          const revisionResult = matchPreferredRoute(filedTokens, variant.route, true);
          const expectedFlow = expectedKiahFlowFromVariantLabel(variant.label);
          const flowConflict =
            routeUsesKiahFlow &&
            expectedFlow !== "Any" &&
            kiahFlow !== "Unknown" &&
            expectedFlow !== kiahFlow;
          const flowBonus = flowConflict ? -0.2 : expectedFlow === "Any" ? 0 : 0.05;
          const scoredExact = Math.max(0, Math.min(1, exactResult.ratio + flowBonus));
          const scoredRevision = Math.max(0, Math.min(1, revisionResult.ratio + flowBonus));

          if (scoredExact > bestRatio) {
            bestRatio = scoredExact;
            bestRule = rule;
            bestVariant = variant;
            bestFlowConflict = flowConflict;
          }

          if (scoredRevision > bestRevisionRatio) {
            bestRevisionRatio = scoredRevision;
            bestRevisionRule = rule;
            bestRevisionVariant = variant;
          }

          if (exactResult.matched) {
            hasExact = true;
            bestRule = rule;
            bestVariant = variant;
            bestRatio = 1;
            bestFlowConflict = flowConflict;
            break;
          }

          if (!exactResult.matched && revisionResult.matched) {
            hasRevisionMatch = true;
          }
        }

        // Track cases where filed route matches a known opposite-flow variant.
        if (routeUsesKiahFlow && kiahFlow !== "Unknown") {
          const filedFirstToken = (filedTokens[0] || "").replace(/#/g, "");
          const sameFlowFirstTokens = new Set();
          const oppositeFlowFirstTokens = new Set();

          for (const variant of variants) {
            const expectedFlow = expectedKiahFlowFromVariantLabel(variant.label);
            const firstOptions = getFirstRouteTokenOptions(variant.route);

            if (expectedFlow === "Any") {
              for (const token of firstOptions) {
                sameFlowFirstTokens.add(token);
              }
              continue;
            }

            if (expectedFlow === kiahFlow) {
              for (const token of firstOptions) {
                sameFlowFirstTokens.add(token);
              }
            } else {
              for (const token of firstOptions) {
                oppositeFlowFirstTokens.add(token);
              }
            }
          }

          if (
            filedFirstToken &&
            oppositeFlowFirstTokens.has(filedFirstToken) &&
            !sameFlowFirstTokens.has(filedFirstToken)
          ) {
            opposingFlowDepartureToken = true;
          }

          for (const variant of variants) {
            const expectedFlow = expectedKiahFlowFromVariantLabel(variant.label);
            if (expectedFlow === "Any" || expectedFlow === kiahFlow) {
              continue;
            }

            const exactResult = matchPreferredRoute(filedTokens, variant.route, false);
            const revisionResult = matchPreferredRoute(filedTokens, variant.route, true);
            if (exactResult.matched || revisionResult.matched) {
              opposingFlowMatched = true;
              break;
            }
          }
        }

        if (hasExact) {
          break;
        }
      }

      if (!hasExact && hasRevisionMatch && bestRevisionVariant) {
        bestRule = bestRevisionRule;
        bestVariant = bestRevisionVariant;
        const expectedFlow = expectedKiahFlowFromVariantLabel(bestVariant.label);
        bestFlowConflict =
          routeUsesKiahFlow &&
          expectedFlow !== "Any" &&
          kiahFlow !== "Unknown" &&
          expectedFlow !== kiahFlow;
      }

      const status = classifyMatch(
        bestRatio,
        hasExact,
        hasRevisionMatch,
        rules.length > 0,
        routeUsesKiahFlow &&
          kiahFlow !== "Unknown" &&
          (opposingFlowMatched || bestFlowConflict || opposingFlowDepartureToken),
      );
      const displayRatio = hasExact ? bestRatio : hasRevisionMatch ? bestRevisionRatio : bestRatio;

      return {
        cid: pilot.cid,
        callsign: pilot.callsign,
        isPrefile: Boolean(pilot?.__isPrefile),
        departure,
        arrival,
        altitude: flightPlan.altitude,
        aircraft: flightPlan.aircraft_short || flightPlan.aircraft,
        rules,
        filedRoute,
        status,
        bestRule,
        bestVariant,
        flowConflict: bestFlowConflict,
        bestRatio: displayRatio,
      };
    });
  }, [arrivalFilter, controlledAirport, kiahFlow, pilots, routeMap, search, showDeparted, showPrefiles]);

  const copyRoute = async (key, route) => {
    if (!route || !navigator?.clipboard) {
      return;
    }

    try {
      await navigator.clipboard.writeText(route);
      setCopiedRouteKey(key);
      setTimeout(() => setCopiedRouteKey(""), 1500);
    } catch {
      setCopiedRouteKey("");
    }
  };

  return (
    <main className="relative min-h-screen overflow-hidden px-6 py-8 md:px-10">
      <div className="ambient-bg" />
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="panel">
          <div className="flex items-start justify-between gap-3">
            <p className="text-accent text-sm font-semibold uppercase tracking-[0.24em]">Traffic</p>
            <Link className="button-secondary text-sm" href="/">
              Back to Toolkit
            </Link>
          </div>
          <h1 className="font-heading text-main mt-1 text-4xl font-bold tracking-wide md:text-5xl">
            Route Validator
          </h1>
          <p className="text-muted mt-2 max-w-4xl">
            Checks VATSIM filed routes for departures at your field against ZHU preferred routes from
            the alias ROUTING section.
          </p>

          <div className="mt-5 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <AirportInput
              airports={routeData.airports || []}
              id="controlled-airport"
              label="Controlled Field"
              onChange={setControlledAirportInput}
              value={controlledAirportInput}
            />
            <AirportInput
              airports={routeData.airports || []}
              id="arrival-filter"
              label="Arrival Filter"
              onChange={setArrivalFilterInput}
              value={arrivalFilterInput}
            />
            <label className="space-y-1" htmlFor="route-search">
              <span className="text-muted text-xs uppercase tracking-[0.16em]">Search</span>
              <input
                className="search w-full"
                id="route-search"
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Callsign, route token, or airport"
                type="search"
                value={searchInput}
              />
            </label>
            <div className="border-default bg-surface-soft rounded-lg border p-3">
              <p className="text-muted text-xs uppercase tracking-[0.16em]">Feed Status</p>
              <p className="text-main mt-1 text-sm font-semibold">
                {fetchError ? "Error" : "Live"}
              </p>
              <p className="text-muted mt-1 text-xs">
                {lastUpdated ? `Updated ${new Date(lastUpdated).toLocaleTimeString()}` : "Waiting..."}
              </p>
            </div>
          </div>

          <label className="mt-3 inline-flex items-center gap-2 text-sm">
            <input
              checked={showDeparted}
              onChange={(event) => setShowDeparted(event.target.checked)}
              type="checkbox"
            />
            <span className="text-muted">Show already departed aircraft</span>
          </label>
          <label className="mt-2 inline-flex items-center gap-2 text-sm">
            <input
              checked={showPrefiles}
              onChange={(event) => setShowPrefiles(event.target.checked)}
              type="checkbox"
            />
            <span className="text-muted">Show prefiles</span>
          </label>

          {fetchError ? <p className="text-rose-600 mt-3 text-sm">{fetchError}</p> : null}

          <div className="mt-4 flex flex-wrap gap-2 text-xs uppercase tracking-[0.14em]">
            <span className="border-default bg-surface-soft text-muted rounded-full border px-3 py-1">
              {routeData.meta.recordCount} preferred routes
            </span>
            <span className="border-default bg-surface-soft text-muted rounded-full border px-3 py-1">
              {validations.length} departures shown
            </span>
            <span className="border-default bg-surface-soft text-muted rounded-full border px-3 py-1">
              KIAH Flow: {kiahFlow}
              {kiahAtisCode ? ` (${kiahAtisCode})` : ""}
            </span>
          </div>
          {atisError ? <p className="text-amber-600 mt-2 text-sm">{atisError}</p> : null}
        </header>

        <section className="panel">
          <div className="overflow-x-auto">
            <table className="route-validator-table min-w-full text-sm">
              <thead className="bg-surface-soft">
                <tr>
                  <th>Callsign</th>
                  <th>DEP</th>
                  <th>ARR</th>
                  <th>Status</th>
                  <th>Filed Route</th>
                  <th>Best Preferred Route</th>
                </tr>
              </thead>
              <tbody>
                {validations.length === 0 ? (
                  <tr>
                    <td className="text-muted" colSpan={6}>
                      No departures match the current filters.
                    </td>
                  </tr>
                ) : (
                  validations.map((row) => (
                    <tr key={`${row.callsign}-${row.cid}`}>
                      <td>
                        <div className="font-mono font-semibold">
                          {row.callsign}
                          {row.isPrefile ? (
                            <span className="border-default bg-surface-soft text-muted ml-2 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em]">
                              PREFILE
                            </span>
                          ) : null}
                        </div>
                        <div className="text-muted text-xs">{row.aircraft || "Unknown"}</div>
                      </td>
                      <td>{row.departure}</td>
                      <td>{row.arrival}</td>
                      <td>
                        <span className={`rv-chip rv-chip-${row.status.tone}`}>{row.status.label}</span>
                      </td>
                      <td className="font-mono">{row.filedRoute || "(empty)"}</td>
                      <td>
                        {row.bestVariant ? (
                          <div>
                            <div className="text-main text-xs font-semibold">{row.bestVariant.label}</div>
                            <div className="font-mono text-xs">{row.bestVariant.route}</div>
                            <div className="text-muted text-[11px]">
                              {row.bestRule?.alias} · {Math.round(row.bestRatio * 100)}% token match
                            </div>
                            {row.status.tone === "bad" ? (
                              <button
                                className="button-secondary mt-2 px-2 py-1 text-[10px] uppercase tracking-[0.12em]"
                                onClick={() =>
                                  copyRoute(
                                    `${row.callsign}-${row.cid}`,
                                    row.bestVariant?.route || "",
                                  )
                                }
                                type="button"
                              >
                                {copiedRouteKey === `${row.callsign}-${row.cid}`
                                  ? "COPIED"
                                  : "COPY ROUTE"}
                              </button>
                            ) : null}
                            {row.flowConflict ? (
                              <div className="text-amber-600 text-[11px]">
                                Flow warning: variant does not match current KIAH {kiahFlow} flow.
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-muted text-xs">No preferred route found for pair</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

