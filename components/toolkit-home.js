"use client";

import Link from "next/link";
import { useMemo } from "react";
import ThemeSwitcher from "@/components/theme-switcher";

function ToolCard({ tool }) {
  const isInternalTool = tool.liveUrl.startsWith("/");

  return (
    <article className="card tool-launcher-card flex h-full flex-col justify-between p-3">
      <div>
        <h3 className="font-heading text-main text-2xl font-semibold tracking-wide">
          {tool.name}
        </h3>
        <p className="text-muted mt-1.5 text-sm leading-relaxed">
          {tool.description}
        </p>
      </div>
      <div className="mt-4 flex gap-2">
        {isInternalTool ? (
          <Link className="button-primary px-3 py-1.5 text-sm" href={tool.liveUrl}>
            Open {tool.name}
          </Link>
        ) : (
          <a
            className="button-primary px-3 py-1.5 text-sm"
            href={tool.liveUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            Open {tool.name}
          </a>
        )}
      </div>
    </article>
  );
}

export default function ToolkitHome({ tools }) {
  const orderedTools = useMemo(() => {
    const preferredOrder = [
      "alias-guide",
      "rvm-list",
      "route-validator",
      "split-map",
      "tfms",
      "adar-routes",
    ];
    const orderIndex = new Map(preferredOrder.map((id, index) => [id, index]));
    return [...tools].sort((a, b) => {
      const aIndex = orderIndex.has(a.id) ? orderIndex.get(a.id) : Number.MAX_SAFE_INTEGER;
      const bIndex = orderIndex.has(b.id) ? orderIndex.get(b.id) : Number.MAX_SAFE_INTEGER;
      if (aIndex !== bIndex) {
        return aIndex - bIndex;
      }
      return a.name.localeCompare(b.name);
    });
  }, [tools]);

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
            <div className="flex flex-col items-end gap-2">
              <ThemeSwitcher />
              <a
                className="button-secondary text-sm"
                href="https://houston.center/"
                rel="noopener noreferrer"
                target="_blank"
              >
                Main Website
              </a>
            </div>
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

        <section aria-live="polite">
          {orderedTools.length === 0 ? (
            <div className="card">
              <p className="text-muted">
                No tools are currently configured.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {orderedTools.map((tool) => (
                <ToolCard key={tool.id} tool={tool} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
