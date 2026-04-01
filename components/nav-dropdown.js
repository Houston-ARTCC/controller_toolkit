"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getTools } from "@/lib/tools";

const tools = getTools().filter((t) => t.liveUrl?.startsWith("/"));

export default function NavDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="button-secondary flex items-center gap-1.5 text-sm"
        type="button"
      >
        Quick Links
        <svg
          className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="border-default bg-surface shadow-lg absolute right-0 top-full z-[9999] mt-1.5 w-52 rounded-xl border py-1.5 text-sm">
          <a
            href="https://houston.center/"
            rel="noopener noreferrer"
            target="_blank"
            className="text-muted hover:text-foreground hover:bg-surface-soft flex items-center gap-2 px-3 py-1.5 transition-colors"
            onClick={() => setOpen(false)}
          >
            <svg className="h-3.5 w-3.5 shrink-0 opacity-60" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            Main Website
          </a>
          <Link
            href="/"
            className="text-muted hover:text-foreground hover:bg-surface-soft flex items-center gap-2 px-3 py-1.5 transition-colors"
            onClick={() => setOpen(false)}
          >
            <svg className="h-3.5 w-3.5 shrink-0 opacity-60" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            Toolkit Home
          </Link>
          {tools.length > 0 && (
            <>
              <div className="border-default my-1 border-t" />
              {tools.map((tool) => (
                <Link
                  key={tool.id}
                  href={tool.liveUrl}
                  className="text-muted hover:text-foreground hover:bg-surface-soft flex items-center justify-between gap-2 px-3 py-1.5 transition-colors"
                  onClick={() => setOpen(false)}
                >
                  {tool.name}
                </Link>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
