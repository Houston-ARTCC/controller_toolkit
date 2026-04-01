"use client";

import { useMemo, useState } from "react";
import ThemeSwitcher from "@/components/theme-switcher";
import NavDropdown from "@/components/nav-dropdown";

function normalizeAirport(value) {
  return value.trim().toUpperCase();
}

function includesAirport(list, airport) {
  if (!airport) {
    return true;
  }

  const normalized = normalizeAirport(airport);
  const stripped = normalized.startsWith("K") ? normalized.slice(1) : normalized;

  return list.some((code) => {
    const normalizedCode = normalizeAirport(code);
    if (normalizedCode === normalized) {
      return true;
    }

    if (normalizedCode.startsWith("K") && normalizedCode.slice(1) === stripped) {
      return true;
    }

    return normalizedCode === stripped;
  });
}

function routeText(route) {
  return route.routeString || "";
}

export default function AdarRoutesPage({ data }) {
  const [departure, setDeparture] = useState("");
  const [arrival, setArrival] = useState("");
  const [routeQuery, setRouteQuery] = useState("");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 15;

  const normalizedRouteQuery = routeQuery.trim().toUpperCase();

  const results = useMemo(() => {
    setPage(0);
    return (data.routes || []).filter((route) => {
      const departureMatch = includesAirport(route.departures || [], departure);
      const arrivalMatch = includesAirport(route.arrivals || [], arrival);
      const routeMatch =
        !normalizedRouteQuery || routeText(route).toUpperCase().includes(normalizedRouteQuery);

      return departureMatch && arrivalMatch && routeMatch;
    });
  }, [arrival, data.routes, departure, normalizedRouteQuery]);

  const pageCount = Math.ceil(results.length / PAGE_SIZE);
  const pageResults = results.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const swapAirports = () => {
    setDeparture(arrival);
    setArrival(departure);
  };

  return (
    <main className="relative min-h-screen overflow-hidden px-6 py-8 md:px-10">
      <div className="ambient-bg" />
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="panel">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-accent text-sm font-semibold uppercase tracking-[0.24em]">Reference</p>
              <h1 className="font-heading text-main mt-1 text-4xl font-bold tracking-wide md:text-5xl">
                ADAR Route Lookup
              </h1>
              <p className="text-muted mt-2 max-w-4xl">
                Search adapted departure/arrival routes by airport pair. This view uses parsed ERAM ADAR
                adaptation data.
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <ThemeSwitcher />
              <NavDropdown />
            </div>
          </div>

          <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_auto_1fr_1fr]">
            <label className="space-y-1">
              <span className="text-muted text-xs uppercase tracking-[0.16em]">Departure</span>
              <input
                className="search w-full"
                list="adar-airports"
                onChange={(event) => setDeparture(event.target.value)}
                placeholder="KIAH or IAH"
                type="search"
                value={departure}
              />
            </label>

            <div className="flex items-end">
              <button className="button-secondary w-full" onClick={swapAirports} type="button">
                Swap
              </button>
            </div>

            <label className="space-y-1">
              <span className="text-muted text-xs uppercase tracking-[0.16em]">Arrival</span>
              <input
                className="search w-full"
                list="adar-airports"
                onChange={(event) => setArrival(event.target.value)}
                placeholder="KAUS or AUS"
                type="search"
                value={arrival}
              />
            </label>

            <label className="space-y-1">
              <span className="text-muted text-xs uppercase tracking-[0.16em]">Route Contains</span>
              <input
                className="search w-full"
                onChange={(event) => setRouteQuery(event.target.value)}
                placeholder="DRLLR5, V568, SAT"
                type="search"
                value={routeQuery}
              />
            </label>
          </div>

          <datalist id="adar-airports">
            {(data.airports || []).map((airport) => (
              <option key={airport} value={airport} />
            ))}
          </datalist>

          <div className="mt-4 flex flex-wrap gap-2 text-xs uppercase tracking-[0.14em]">
            <span className="border-default bg-surface-soft text-muted rounded-full border px-3 py-1">
              {data.meta.routeCount} routes
            </span>
            <span className="border-default bg-surface-soft text-muted rounded-full border px-3 py-1">
              {data.meta.airportCount} airports
            </span>
            <span className="border-default bg-surface-soft text-muted rounded-full border px-3 py-1">
              {results.length} matches
            </span>
          </div>
        </header>

        <section className="panel">
          {results.length === 0 ? (
            <p className="text-muted">No matching ADAR records for this filter combination.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="adar-table min-w-full text-sm">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Departure</th>
                      <th>Arrival</th>
                      <th>Route</th>
                      <th>AC Criteria</th>
                      <th>Altitudes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageResults.map((route) => (
                      <tr key={route.adarId}>
                        <td className="font-mono font-semibold">{route.adarId}</td>
                        <td>{(route.departures || []).join(", ")}</td>
                        <td>{(route.arrivals || []).join(", ")}</td>
                        <td className="font-mono">{routeText(route)}</td>
                        <td>
                          {(route.aircraftCriteriaDetails || []).length === 0
                            ? "N/A"
                            : route.aircraftCriteriaDetails
                                .map((criteria) => {
                                  const suffix = criteria.isExcluded ? " (Excluded)" : "";
                                  return `${criteria.id} (${criteria.facility})${suffix}`;
                                })
                                .join(", ")}
                        </td>
                        <td>
                          {route.lowerAltitude}-{route.upperAltitude}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pageCount > 1 && (
                <div className="border-default mt-0 flex items-center justify-between border-t px-3 py-2">
                  <span className="text-muted text-xs">
                    {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, results.length)} of {results.length}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="button-secondary px-2 py-1 text-xs disabled:opacity-40"
                    >
                      ‹ Prev
                    </button>
                    <span className="text-muted px-2 text-xs">{page + 1} / {pageCount}</span>
                    <button
                      onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                      disabled={page === pageCount - 1}
                      className="button-secondary px-2 py-1 text-xs disabled:opacity-40"
                    >
                      Next ›
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}

