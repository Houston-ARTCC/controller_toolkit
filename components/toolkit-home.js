"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

const iconByName = {
  radar: "RD",
  book: "AL",
  layers: "SP",
  map: "RV",
};

function ToolCard({ tool }) {
  const isInternalTool = tool.liveUrl.startsWith("/");

  return (
    <article className="card flex h-full flex-col justify-between">
      <div>
        <div className="mb-4 flex items-center justify-between">
          <span className="icon-badge inline-flex h-9 w-9 items-center justify-center rounded-lg text-xs font-bold">
            {iconByName[tool.icon] ?? "TL"}
          </span>
          <span className="badge">{tool.status}</span>
        </div>
        <h3 className="font-heading text-main text-2xl font-semibold tracking-wide">
          {tool.name}
        </h3>
        <p className="text-muted mt-2 text-base leading-relaxed">
          {tool.description}
        </p>
        <ul className="mt-4 flex flex-wrap gap-2">
          {tool.tags.map((tag) => (
            <li
              className="border-default bg-surface-soft text-muted rounded-full border px-2.5 py-1 text-xs uppercase tracking-wide"
              key={tag}
            >
              {tag}
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-6 flex gap-3">
        {isInternalTool ? (
          <Link className="button-primary" href={tool.liveUrl}>
            Open Tool
          </Link>
        ) : (
          <a
            className="button-primary"
            href={tool.liveUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            Open Tool
          </a>
        )}
        {isInternalTool ? (
          <a
            className="button-secondary"
            href={tool.url}
            rel="noopener noreferrer"
            target="_blank"
          >
            Source
          </a>
        ) : (
          <Link className="button-secondary" href={`/tools/${tool.id}`}>
            Details
          </Link>
        )}
      </div>
    </article>
  );
}

export default function ToolkitHome({ tools, categories }) {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");

  const filteredTools = useMemo(() => {
    return tools.filter((tool) => {
      const text = `${tool.name} ${tool.description} ${tool.tags.join(" ")}`.toLowerCase();
      const matchesQuery = text.includes(query.toLowerCase().trim());
      const matchesCategory =
        activeCategory === "All" || tool.category === activeCategory;
      return matchesQuery && matchesCategory;
    });
  }, [activeCategory, query, tools]);

  return (
    <main className="relative min-h-screen overflow-hidden px-6 py-8 md:px-10">
      <div className="ambient-bg" />
      <div className="mx-auto max-w-6xl">
        <header className="border-default bg-surface mb-5 rounded-xl border px-5 py-3 shadow-sm backdrop-blur">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-heading text-main text-xl font-semibold tracking-wide">
                Houston ARTCC
              </p>
              <p className="text-muted text-sm">Controller Toolkit</p>
            </div>
            <a
              className="button-secondary text-sm"
              href="https://houston.center/"
              rel="noopener noreferrer"
              target="_blank"
            >
              Main Website
            </a>
          </div>
        </header>

        <section className="hero-panel mb-8 flex items-end p-6 md:p-8">
          <div>
            <p className="mb-2 text-sm font-semibold uppercase tracking-[0.24em] text-sky-200">
              Controllers
            </p>
            <h1 className="font-heading text-5xl font-bold tracking-wide text-white md:text-6xl">
              Quick Tool Access
            </h1>
            <p className="mt-3 max-w-2xl text-lg text-slate-100">
              Unified launchpad for controller resources with a single registry
              for current and future tools.
            </p>
          </div>
        </section>

        <section className="panel mb-8">
          <div className="grid gap-3 md:grid-cols-[2fr_3fr]">
            <label htmlFor="tool-search" className="sr-only">
              Search tools
            </label>
            <input
              className="search"
              id="tool-search"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by tool name, feature, or tag"
              type="search"
              value={query}
            />
            <div className="flex flex-wrap gap-2">
              {["All", ...categories].map((category) => (
                <button
                  className={category === activeCategory ? "chip chip-active" : "chip"}
                  key={category}
                  onClick={() => setActiveCategory(category)}
                  type="button"
                >
                  {category}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section aria-live="polite">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-heading text-main text-2xl font-semibold tracking-wide">
              Tools
            </h2>
            <span className="text-muted text-sm uppercase tracking-[0.2em]">
              {filteredTools.length} Result{filteredTools.length === 1 ? "" : "s"}
            </span>
          </div>

          {filteredTools.length === 0 ? (
            <div className="card">
              <p className="text-muted">
                No tools match the current filters. Try another search term or
                category.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filteredTools.map((tool) => (
                <ToolCard key={tool.id} tool={tool} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
