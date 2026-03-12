"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";

function countEntries(sections) {
  return sections.reduce(
    (total, section) => total + section.tables.reduce((sum, table) => sum + table.entries.length, 0),
    0,
  );
}

function normalizeGuideData(guideData) {
  const sections = (guideData.sections || []).map((section) => {
    const tables = (section.tables || []).map((table) => {
      const commandIndex = (table.columns || []).findIndex((column) => /command/i.test(column));

      const entries = (table.entries || []).map((entry) => ({
        ...entry,
        searchText: entry.cells.map((cell) => cell.text).join(" ").toLowerCase(),
      }));

      const tableSearchText = `${table.title} ${(table.columns || []).join(" ")} ${entries
        .map((entry) => entry.cells.map((cell) => cell.text).join(" "))
        .join(" ")}`.toLowerCase();

      return {
        ...table,
        commandIndex: commandIndex >= 0 ? commandIndex : 0,
        searchText: tableSearchText,
        entries,
      };
    });

    const sectionSearchText = `${section.title} ${(section.intro || [])
      .map((intro) => intro.text)
      .join(" ")} ${tables.map((table) => table.searchText).join(" ")}`.toLowerCase();

    return {
      ...section,
      searchText: sectionSearchText,
      tables,
    };
  });

  return {
    meta: guideData.meta || {},
    sections,
  };
}

function subscribeToUrlChanges(onStoreChange) {
  if (typeof window === "undefined") {
    return () => {};
  }

  window.addEventListener("popstate", onStoreChange);
  window.addEventListener("hashchange", onStoreChange);

  return () => {
    window.removeEventListener("popstate", onStoreChange);
    window.removeEventListener("hashchange", onStoreChange);
  };
}

function getAliasParamFromUrl() {
  if (typeof window === "undefined") {
    return "";
  }

  return new URLSearchParams(window.location.search).get("alias") || "";
}

function SectionExplorer({ section, enablePermalinks = false }) {
  const groups = section.tables.map((table, index) => {
    const titleLooksGeneric = /^Table \d+$/i.test(table.title || "");
    const groupTitle =
      titleLooksGeneric && section.tables.length === 1
        ? "Commands"
        : table.title || `Group ${index + 1}`;

    const entries = table.entries.map((entry) => ({
      ...entry,
      groupId: table.id,
      groupTitle,
      commandHtml: entry.cells[table.commandIndex]?.html || entry.cells[0]?.html || "",
      detailHtml:
        entry.cells.find((cell, cellIndex) => cellIndex !== table.commandIndex)?.html || "",
    }));

    return {
      id: table.id,
      title: groupTitle,
      entries,
    };
  });

  const allEntries = groups.flatMap((group) => group.entries);
  const [selectedId, setSelectedId] = useState("");
  const [manualOpenGroupId, setManualOpenGroupId] = useState(null);
  const [copiedLinkId, setCopiedLinkId] = useState("");
  const aliasFromUrl = useSyncExternalStore(
    subscribeToUrlChanges,
    getAliasParamFromUrl,
    () => "",
  );

  const selectedFromUrl = enablePermalinks
    ? allEntries.find((entry) => entry.id === aliasFromUrl) || null
    : null;
  const selectedEntry =
    allEntries.find((entry) => entry.id === selectedId) || selectedFromUrl || null;
  const effectiveOpenGroupId = manualOpenGroupId ?? selectedEntry?.groupId ?? "";

  const getAliasUrl = (entryId) => {
    const url = new URL(window.location.href);
    url.searchParams.set("alias", entryId);
    url.hash = section.id;
    return url.toString();
  };

  const selectEntry = (entry) => {
    setSelectedId(entry.id);
    setManualOpenGroupId(entry.groupId);

    if (!enablePermalinks || typeof window === "undefined") {
      return;
    }

    const url = getAliasUrl(entry.id);
    window.history.replaceState({}, "", url);
  };

  const copyAliasUrl = async (entry) => {
    if (!enablePermalinks || typeof window === "undefined") {
      return;
    }

    const url = getAliasUrl(entry.id);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLinkId(entry.id);
      setTimeout(() => setCopiedLinkId(""), 1200);
    } catch {
      setCopiedLinkId("");
    }
  };

  const toggleGroup = (groupId) => {
    setManualOpenGroupId((prev) => {
      const current = prev ?? selectedEntry?.groupId ?? "";
      return current === groupId ? "" : groupId;
    });
  };

  if (allEntries.length === 0) {
    return (
      <article className="card">
        <p className="text-muted">
          No matching entries found for this search.
        </p>
      </article>
    );
  }

  return (
    <section className="mt-4 grid gap-3 lg:grid-cols-[20rem_1fr]">
      <aside className="border-default bg-surface-soft rounded-xl border p-3">
        <p className="text-muted mb-2 text-xs uppercase tracking-[0.16em]">
          Commands
        </p>
        <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
          {groups.map((group) => (
            <section key={group.id}>
              <button
                className="border-default bg-surface w-full rounded-lg border px-3 py-2 text-left"
                onClick={() => toggleGroup(group.id)}
                type="button"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-muted text-xs font-semibold uppercase tracking-[0.16em]">
                    {group.title}
                  </h3>
                  <span className="text-muted text-xs">
                    {effectiveOpenGroupId === group.id ? "-" : "+"} {group.entries.length}
                  </span>
                </div>
              </button>
              {effectiveOpenGroupId === group.id ? (
                <ul className="mt-2 space-y-2">
                  {group.entries.map((entry) => {
                    const isActive = entry.id === selectedEntry?.id;
                    return (
                      <li key={entry.id}>
                      <button
                        className={
                          isActive
                            ? "border-default bg-surface w-full rounded-lg border px-3 py-2 text-left"
                            : "border-default bg-surface-soft w-full rounded-lg border px-3 py-2 text-left transition hover:bg-surface"
                        }
                        onClick={() => selectEntry(entry)}
                        type="button"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={isActive ? "alias-rich text-accent font-mono text-sm font-semibold" : "alias-rich text-main font-mono text-sm font-semibold"}
                            dangerouslySetInnerHTML={{ __html: entry.commandHtml }}
                          />
                          {enablePermalinks ? (
                            <span
                              className="text-muted border-default bg-surface rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em]"
                              onClick={(event) => {
                                event.stopPropagation();
                                copyAliasUrl(entry);
                              }}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  copyAliasUrl(entry);
                                }
                              }}
                            >
                              {copiedLinkId === entry.id ? "Copied" : "Link"}
                            </span>
                          ) : null}
                        </div>
                      </button>
                    </li>
                  );
                  })}
                </ul>
              ) : null}
            </section>
          ))}
        </div>
      </aside>

      <article className="border-default bg-surface h-fit rounded-xl border p-5 shadow-sm lg:sticky lg:top-4">
        {selectedEntry ? (
          <>
            <p className="text-muted mb-2 text-xs uppercase tracking-[0.16em]">
              Category
            </p>
            <p className="text-accent mb-3 text-sm font-semibold">{selectedEntry.groupTitle}</p>
            <p className="text-muted mb-2 text-xs uppercase tracking-[0.16em]">
              Selected Command
            </p>
            <div
              className="alias-rich text-main font-mono text-lg font-semibold"
              dangerouslySetInnerHTML={{ __html: selectedEntry.commandHtml }}
            />
            <div className="border-default my-4 border-t" />
            <p className="text-muted mb-2 text-xs uppercase tracking-[0.16em]">
              Meaning
            </p>
            <div
              className="alias-rich text-main text-base leading-relaxed"
              dangerouslySetInnerHTML={{ __html: selectedEntry.detailHtml }}
            />
          </>
        ) : (
          <p className="text-muted text-sm">
            Choose an alias on the left to see details.
          </p>
        )}
      </article>
    </section>
  );
}

function InformationalTableSection({
  section,
  leftLabel = "Command",
  rightLabel = "Result",
  leftIndex = 0,
  rightIndex = null,
  emphasizeLeft = true,
}) {
  const table = section.tables[0];
  const entries = table?.entries || [];
  const resolvedRightIndex =
    rightIndex ?? Math.max((table?.columns?.length || 1) - 1, 0);

  if (entries.length === 0) {
    return (
      <article className="card mt-4">
        <p className="text-muted">No guidance is available yet for this section.</p>
      </article>
    );
  }

  return (
    <section className="mt-4">
      <div className="border-default bg-surface overflow-x-auto rounded-xl border">
        <table className="min-w-full text-sm">
          <thead className="bg-surface-soft">
            <tr>
              <th className="text-muted border-default border-b px-4 py-3 text-left text-xs uppercase tracking-[0.16em]">
                {leftLabel}
              </th>
              <th className="text-muted border-default border-b px-4 py-3 text-left text-xs uppercase tracking-[0.16em]">
                {rightLabel}
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr className="border-default border-b last:border-b-0" key={entry.id}>
                <td
                  className={
                    emphasizeLeft
                      ? "alias-rich text-accent px-4 py-3 font-mono font-semibold"
                      : "alias-rich text-main px-4 py-3 font-mono"
                  }
                >
                  <span dangerouslySetInnerHTML={{ __html: entry.cells[leftIndex]?.html || "" }} />
                </td>
                <td className="alias-rich text-main px-4 py-3">
                  <span
                    dangerouslySetInnerHTML={{
                      __html: entry.cells[resolvedRightIndex]?.html || "",
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function AliasGuidePage({ guideData }) {
  const [query, setQuery] = useState("");

  const normalized = useMemo(() => normalizeGuideData(guideData), [guideData]);

  const filteredSections = useMemo(() => {
    const filter = query.toLowerCase().trim();
    if (!filter) {
      return normalized.sections;
    }

    return normalized.sections
      .map((section) => {
        const sectionMatches = section.searchText.includes(filter);

        const tables = section.tables
          .map((table) => {
            const tableMatches = table.searchText.includes(filter);
            const entries = table.entries.filter(
              (entry) => sectionMatches || tableMatches || entry.searchText.includes(filter),
            );
            return {
              ...table,
              entries,
            };
          })
          .filter((table) => table.entries.length > 0);

        if (!sectionMatches && tables.length === 0) {
          return null;
        }

        return {
          ...section,
          tables,
        };
      })
      .filter(Boolean);
  }, [normalized.sections, query]);

  const totalEntries = countEntries(normalized.sections);
  const matchedEntries = countEntries(filteredSections);

  const explorerSectionTitles = new Set([
    "CRC/ZHU Basics",
    "Pilot Help Messages",
  ]);

  return (
    <main className="relative min-h-screen overflow-hidden px-6 py-8 md:px-10">
      <div className="ambient-bg" />
      <div className="mx-auto max-w-[90rem] space-y-6">
        <header className="panel">
          <div className="flex items-start justify-between gap-3">
            <p className="text-accent text-sm font-semibold uppercase tracking-[0.24em]">Controllers</p>
            <Link className="button-secondary text-sm" href="/">
              Back to Toolkit
            </Link>
          </div>
          <h1 className="font-heading text-main mt-1 text-4xl font-bold tracking-wide md:text-5xl">
            Alias Guide
          </h1>
          <p className="text-muted mt-2 max-w-4xl">
            Refactored for faster use with sidebar navigation, instant search, and card-based command
            browsing.
          </p>

          <div className="mt-5 grid gap-3 md:grid-cols-[2fr_1fr]">
            <input
              className="search"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search command, example, phraseology, or notes"
              type="search"
              value={query}
            />
            <div className="text-muted flex flex-wrap gap-2 text-xs uppercase tracking-[0.16em]">
              <span className="border-default bg-surface-soft rounded-full border px-3 py-1">
                {normalized.sections.length} Sections
              </span>
              <span className="border-default bg-surface-soft rounded-full border px-3 py-1">
                {matchedEntries} / {totalEntries} Commands
              </span>
              {normalized.meta.updated ? (
                <span className="border-default bg-surface-soft rounded-full border px-3 py-1">
                  {normalized.meta.updated}
                </span>
              ) : null}
            </div>
          </div>
        </header>

        <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
          <aside className="panel h-fit lg:sticky lg:top-4">
            <h2 className="font-heading text-main text-2xl font-semibold">Sections</h2>
            <nav className="mt-3 max-h-[70vh] space-y-2 overflow-y-auto pr-1">
              {filteredSections.map((section) => (
                <a
                  className="border-default text-main block rounded-lg border px-3 py-2 text-sm transition hover:bg-surface-soft"
                  href={`#${section.id}`}
                  key={section.id}
                >
                  <p className="font-semibold">{section.title}</p>
                  <p className="text-muted text-xs">
                    {section.tables.reduce((sum, table) => sum + table.entries.length, 0)} entries
                  </p>
                </a>
              ))}
            </nav>
          </aside>

          <section className="space-y-5" aria-live="polite">
            {filteredSections.length === 0 ? (
              <article className="card">
                <h3 className="font-heading text-main text-2xl font-semibold">No matches found</h3>
                <p className="text-muted mt-2">
                  Try a broader term like <span className="font-mono">.bad</span>,
                  <span className="font-mono"> wallop</span>, or <span className="font-mono">departure</span>.
                </p>
              </article>
            ) : (
              filteredSections.map((section) => (
                <article className="panel scroll-mt-24" id={section.id} key={section.id}>
                  <h2 className="font-heading text-main text-3xl font-semibold">{section.title}</h2>

                  {(section.intro || []).length > 0 ? (
                    <div className="alias-intro text-muted mt-3 space-y-2">
                      {section.intro.map((paragraph) => (
                        <p
                          className="alias-rich"
                          dangerouslySetInnerHTML={{ __html: paragraph.html }}
                          key={paragraph.id}
                        />
                      ))}
                    </div>
                  ) : null}

                  {section.title === "Autotrack" ? (
                    <InformationalTableSection
                      leftLabel="Command"
                      rightLabel="Result"
                      section={section}
                    />
                  ) : section.title === "Standard Routes" ? (
                    <InformationalTableSection
                      leftLabel="Entering"
                      rightLabel="Returns"
                      section={section}
                    />
                  ) : explorerSectionTitles.has(section.title) ? (
                    <SectionExplorer
                      enablePermalinks={
                        section.title === "CRC/ZHU Basics" ||
                        section.title === "Pilot Help Messages"
                      }
                      section={section}
                    />
                  ) : (
                    <div className="mt-5 space-y-5">
                      {section.tables.map((table) => (
                        <section key={table.id}>
                          <h3 className="font-heading text-main text-xl font-semibold">{table.title}</h3>
                          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                            {table.entries.map((entry) => {
                              const commandHtml =
                                entry.cells[table.commandIndex]?.html || entry.cells[0]?.html || "";

                              return (
                                <article className="border-default bg-surface rounded-xl border p-4 shadow-sm" key={entry.id}>
                                  <div className="mb-3">
                                    <div
                                      className="alias-rich text-main font-mono text-sm font-semibold"
                                      dangerouslySetInnerHTML={{ __html: commandHtml }}
                                    />
                                  </div>

                                  <dl className="space-y-2">
                                    {entry.cells.map((cell, index) => {
                                      if (index === table.commandIndex) {
                                        return null;
                                      }

                                      const label =
                                        table.columns[index] ||
                                        (table.commandIndex === 0 && index === 1 ? "Details" : `Field ${index + 1}`);

                                      return (
                                        <div key={`${entry.id}-field-${index}`}>
                                          <dt className="text-muted text-xs uppercase tracking-[0.16em]">
                                            {label}
                                          </dt>
                                          <dd
                                            className="alias-rich text-main text-sm"
                                            dangerouslySetInnerHTML={{ __html: cell.html }}
                                          />
                                        </div>
                                      );
                                    })}
                                  </dl>
                                </article>
                              );
                            })}
                          </div>
                        </section>
                      ))}
                    </div>
                  )}
                </article>
              ))
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
