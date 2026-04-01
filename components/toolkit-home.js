"use client";

import Link from "next/link";
import { useMemo } from "react";
import ThemeSwitcher from "@/components/theme-switcher";
import NavDropdown from "@/components/nav-dropdown";

const DEV_STATUS_STYLES = {
  "LIVE":             { chip: "bg-emerald-500/15 text-emerald-400 ring-emerald-500/25", color: "#10b981" },
  "PROTOTYPE":        { chip: "bg-violet-500/15 text-violet-400 ring-violet-500/25",   color: "#8b5cf6" },
  "REDESIGN PLANNED": { chip: "bg-orange-500/15 text-orange-400 ring-orange-500/25",   color: "#f97316" },
};
const DEFAULT_STATUS = { chip: "bg-slate-500/15 text-slate-400 ring-slate-500/25", color: "#64748b" };

function ToolCard({ tool }) {
  const isInternalTool = tool.liveUrl.startsWith("/");
  const { chip: chipClass, color: statusColor } = DEV_STATUS_STYLES[tool.devStatus] ?? DEFAULT_STATUS;

  const cardClass = "card tool-launcher-card flex h-full flex-col p-4";
  const cardStyle = { "--status-color": statusColor };

  const content = (
    <>
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className="font-heading text-main text-2xl font-semibold tracking-wide">
          {tool.name}
        </h3>
        <span className={`mt-1 shrink-0 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ring-1 ${chipClass}`}>
          {tool.devStatus}
        </span>
      </div>
      <p className="text-muted text-sm leading-relaxed">{tool.description}</p>
    </>
  );

  if (isInternalTool) {
    return <Link href={tool.liveUrl} className={cardClass} style={cardStyle}>{content}</Link>;
  }
  return (
    <a href={tool.liveUrl} rel="noopener noreferrer" target="_blank" className={cardClass} style={cardStyle}>
      {content}
    </a>
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
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="panel">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-accent text-sm font-semibold uppercase tracking-[0.24em]">Houston ARTCC</p>
              <h1 className="font-heading text-main mt-1 text-4xl font-bold tracking-wide md:text-5xl">
                Controller Toolkit
              </h1>
              <p className="text-muted mt-2 max-w-4xl">
                Tools and references for ZHU controllers, all in one place.
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <ThemeSwitcher />
              <NavDropdown />
            </div>
          </div>
        </header>

        <section aria-live="polite">
          {orderedTools.length === 0 ? (
            <div className="card">
              <p className="text-muted">No tools are currently configured.</p>
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
