"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

const SECTION_TABLE_CONFIG = {
  Autotrack: {
    columns: [
      { label: "Command", sourceIndex: 0, emphasize: true },
      { label: "Result", sourceIndex: 2 },
    ],
  },
  "Standard Routes": {
    columns: [
      { label: "Entering", sourceIndex: 0, emphasize: true },
      { label: "Returns", sourceIndex: 1 },
    ],
  },
};

function subscribeToHashChanges(onStoreChange) {
  if (typeof window === "undefined") {
    return () => {};
  }

  window.addEventListener("hashchange", onStoreChange);
  window.addEventListener("popstate", onStoreChange);

  return () => {
    window.removeEventListener("hashchange", onStoreChange);
    window.removeEventListener("popstate", onStoreChange);
  };
}

function getHashValue() {
  if (typeof window === "undefined") {
    return "";
  }

  return decodeURIComponent(window.location.hash.replace(/^#/, ""));
}

function normalizeGuideData(guideData) {
  const sections = (guideData.sections || []).map((section) => {
    const tables = (section.tables || []).map((table) => {
      const entries = (table.entries || []).map((entry) => ({
        ...entry,
        searchText: (entry.cells || []).map((cell) => cell.text).join(" ").toLowerCase(),
      }));

      const tableSearchText = `${table.title || ""} ${(table.columns || []).join(" ")} ${entries
        .map((entry) => (entry.cells || []).map((cell) => cell.text).join(" "))
        .join(" ")}`.toLowerCase();

      return {
        ...table,
        entries,
        searchText: tableSearchText,
      };
    });

    const sectionSearchText = `${section.title} ${(section.intro || [])
      .map((item) => item.text)
      .join(" ")} ${tables.map((table) => table.searchText).join(" ")}`.toLowerCase();

    return {
      ...section,
      tables,
      searchText: sectionSearchText,
    };
  });

  return {
    meta: guideData.meta || {},
    sections,
  };
}

function getGlobalFirstColumnWidthCh(sections) {
  let longest = 0;

  for (const section of sections || []) {
    for (const table of section.tables || []) {
      for (const entry of table.entries || []) {
        const commandText = (entry.cells?.[0]?.text || "").replace(/\s+/g, " ").trim();
        if (commandText.length > longest) {
          longest = commandText.length;
        }
      }
    }
  }

  // Keep width readable and bounded across desktop/mobile.
  return Math.max(14, Math.min(34, longest + 2));
}

function defaultColumns(table) {
  const sourceColumns = table.columns || [];

  if (sourceColumns.length > 0) {
    return sourceColumns.map((label, sourceIndex) => ({
      label,
      sourceIndex,
      emphasize: sourceIndex === 0,
    }));
  }

  return [
    { label: "Command", sourceIndex: 0, emphasize: true },
    { label: "Result", sourceIndex: 1 },
  ];
}

function getDisplayColumns(sectionTitle, table) {
  const config = SECTION_TABLE_CONFIG[sectionTitle];
  return config?.columns || defaultColumns(table);
}

function ReferenceTable({
  copiedLinkId,
  currentHash,
  firstColumnWidthCh,
  onCopyLink,
  sectionTitle,
  table,
}) {
  const displayColumns = getDisplayColumns(sectionTitle, table);
  const hasGenericTitle = /^table\s+\d+$/i.test((table.title || "").trim());
  const showTableTitle = Boolean(table.title) && !hasGenericTitle;

  if ((table.entries || []).length === 0) {
    return null;
  }

  return (
    <section key={table.id}>
      {showTableTitle ? (
        <h3 className="font-heading text-main text-xl font-semibold">{table.title}</h3>
      ) : null}
      <div className="border-default bg-surface mt-3 overflow-x-auto rounded-xl border">
        <table className="min-w-full text-sm">
          <colgroup>
            {displayColumns.map((column, index) => (
              <col
                key={`${table.id}-coldef-${column.sourceIndex}`}
                style={index === 0 ? { width: `${firstColumnWidthCh}ch` } : undefined}
              />
            ))}
            <col style={{ width: "5.5rem" }} />
          </colgroup>
          <thead className="bg-surface-soft">
            <tr>
              {displayColumns.map((column) => (
                <th
                  className="text-muted border-default border-b px-4 py-3 text-left text-xs uppercase tracking-[0.16em]"
                  key={`${table.id}-head-${column.sourceIndex}`}
                >
                  {column.label}
                </th>
              ))}
              <th
                aria-label="Entry Link"
                className="text-muted border-default border-b px-4 py-3 text-right text-xs uppercase tracking-[0.16em]"
              >
                <span className="sr-only">Entry Link</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {table.entries.map((entry) => (
              <tr
                className={
                  entry.id === currentHash
                    ? "alias-anchor-hit border-default border-b last:border-b-0"
                    : "border-default border-b last:border-b-0"
                }
                id={entry.id}
                key={entry.id}
              >
                {displayColumns.map((column, columnPosition) => {
                  const html = entry.cells[column.sourceIndex]?.html || "";
                  const cellClass = column.emphasize
                    ? "alias-rich text-accent px-4 py-3 font-mono font-semibold"
                    : "alias-rich text-main px-4 py-3";

                  return (
                    <td className={cellClass} key={`${entry.id}-col-${column.sourceIndex}`}>
                      {columnPosition === 0 ? (
                        <span dangerouslySetInnerHTML={{ __html: html }} />
                      ) : (
                        <span dangerouslySetInnerHTML={{ __html: html }} />
                      )}
                    </td>
                  );
                })}
                <td className="px-4 py-3 text-right">
                  <button
                    className="text-muted border-default bg-surface-soft shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em]"
                    onClick={() => onCopyLink(entry.id)}
                    type="button"
                  >
                    {copiedLinkId === entry.id ? "Copied" : "Link"}
                  </button>
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
  const [copiedLinkId, setCopiedLinkId] = useState("");
  const [activeSectionId, setActiveSectionId] = useState("");
  const currentHash = useSyncExternalStore(subscribeToHashChanges, getHashValue, () => "");

  const normalized = useMemo(() => normalizeGuideData(guideData), [guideData]);
  const firstColumnWidthCh = useMemo(
    () => getGlobalFirstColumnWidthCh(normalized.sections),
    [normalized.sections],
  );

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

  const resolvedActiveSectionId = useMemo(() => {
    if (filteredSections.length === 0) {
      return "";
    }

    return filteredSections.some((section) => section.id === activeSectionId)
      ? activeSectionId
      : filteredSections[0].id;
  }, [activeSectionId, filteredSections]);

  useEffect(() => {
    if (filteredSections.length === 0 || typeof window === "undefined") {
      return;
    }

    const elements = filteredSections
      .map((section) => document.getElementById(section.id))
      .filter(Boolean);

    if (elements.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length === 0) {
          return;
        }

        visible.sort(
          (a, b) =>
            b.intersectionRatio - a.intersectionRatio ||
            a.boundingClientRect.top - b.boundingClientRect.top,
        );

        setActiveSectionId(visible[0].target.id);
      },
      {
        root: null,
        rootMargin: "-18% 0px -62% 0px",
        threshold: [0.1, 0.25, 0.5, 0.75],
      },
    );

    elements.forEach((element) => observer.observe(element));

    return () => observer.disconnect();
  }, [filteredSections]);

  useEffect(() => {
    if (!currentHash || typeof window === "undefined") {
      return;
    }

    const target = document.getElementById(currentHash);
    if (!target) {
      return;
    }

    const topPadding = 120;
    const targetTop = window.scrollY + target.getBoundingClientRect().top - topPadding;
    window.scrollTo({ top: Math.max(targetTop, 0), behavior: "smooth" });
  }, [currentHash]);

  const copyEntryLink = async (entryId) => {
    const url = new URL(window.location.href);
    url.hash = entryId;

    try {
      await navigator.clipboard.writeText(url.toString());
      setCopiedLinkId(entryId);
      setTimeout(() => setCopiedLinkId(""), 1200);
    } catch {
      setCopiedLinkId("");
    }
  };

  return (
    <main className="relative min-h-screen px-6 py-8 md:px-10 lg:pl-24">
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
            Structured reference view. Every section uses the same layout pattern for easier
            editing and readability.
          </p>

          <div className="mt-5 grid gap-3 md:grid-cols-[2fr_1fr]">
            <input
              className="search"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search command text, examples, and descriptions"
              type="search"
              value={query}
            />
            <div className="text-muted flex flex-wrap gap-2 text-xs uppercase tracking-[0.16em]">
              {normalized.meta.updated ? (
                <span className="border-default bg-surface-soft inline-flex items-center rounded-full border px-3 py-1 text-center">
                  {normalized.meta.updated}
                </span>
              ) : null}
            </div>
          </div>
        </header>

        <div className="group/sections fixed left-2 top-1/2 z-50 hidden -translate-y-1/2 lg:block">
          <div className="relative flex items-center">
            <div className="button-primary -rotate-90 origin-left rounded-t-xl rounded-b-none rounded-l-none px-6 py-3 text-base font-extrabold uppercase tracking-[0.2em] shadow-lg transition group-hover/sections:translate-x-1">
              Sections
            </div>
            <nav className="section-flyout absolute left-full ml-3 max-h-[75vh] w-72 space-y-2 overflow-y-auto rounded-xl p-3 opacity-0 shadow-xl transition duration-200 group-hover/sections:opacity-100 group-focus-within/sections:opacity-100">
              {filteredSections.map((section) => (
                <a
                  className={
                    resolvedActiveSectionId === section.id
                      ? "border-accent bg-surface-soft text-main block rounded-lg border px-3 py-2 text-sm transition"
                      : "border-default text-main block rounded-lg border px-3 py-2 text-sm transition hover:bg-surface-soft"
                  }
                  href={`#${section.id}`}
                  key={section.id}
                >
                  <p className="font-semibold">{section.title}</p>
                </a>
              ))}
            </nav>
          </div>
        </div>

        <div className="space-y-5">
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

                  <div className="mt-5 space-y-5">
                    {section.tables.map((table) => (
                      <ReferenceTable
                        copiedLinkId={copiedLinkId}
                        currentHash={currentHash}
                        firstColumnWidthCh={firstColumnWidthCh}
                        key={table.id}
                        onCopyLink={copyEntryLink}
                        sectionTitle={section.title}
                        table={table}
                      />
                    ))}
                  </div>
                </article>
              ))
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
