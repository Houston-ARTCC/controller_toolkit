import Link from "next/link";
import { notFound } from "next/navigation";
import { getToolById, getTools } from "@/lib/tools";

export function generateStaticParams() {
  return getTools()
    .filter((tool) => tool.id !== "alias-guide")
    .map((tool) => ({ id: tool.id }));
}

export function generateMetadata({ params }) {
  const tool = getToolById(params.id);
  if (!tool) {
    return {
      title: "Tool Not Found | ZHU Controller Toolkit",
    };
  }

  return {
    title: `${tool.name} | ZHU Controller Toolkit`,
    description: tool.description,
  };
}

export default function ToolDetailsPage({ params }) {
  const tool = getToolById(params.id);

  if (!tool) {
    notFound();
  }

  return (
    <main className="relative min-h-screen overflow-hidden px-6 py-10 md:px-10">
      <div className="ambient-bg" />
      <div className="mx-auto max-w-4xl">
        <article className="panel">
          <p className="text-accent mb-2 text-sm font-semibold uppercase tracking-[0.24em]">
            {tool.category}
          </p>
          <h1 className="font-heading text-main text-5xl font-bold tracking-wide md:text-6xl">
            {tool.name}
          </h1>
          <p className="text-muted mt-3 text-lg">{tool.description}</p>

          <div className="mt-6 flex flex-wrap gap-2">
            {tool.tags.map((tag) => (
              <span
                className="border-default bg-surface-soft text-muted rounded-full border px-2.5 py-1 text-xs uppercase tracking-wide"
                key={tag}
              >
                {tag}
              </span>
            ))}
          </div>

          <dl className="border-default bg-surface-soft mt-8 grid gap-3 rounded-xl border p-5 md:grid-cols-2">
            <div>
              <dt className="text-accent text-xs uppercase tracking-[0.2em]">Status</dt>
              <dd className="text-main mt-1 text-lg font-semibold">{tool.status}</dd>
            </div>
            <div>
              <dt className="text-accent text-xs uppercase tracking-[0.2em]">Tool ID</dt>
              <dd className="text-main mt-1 font-mono text-base">{tool.id}</dd>
            </div>
          </dl>

          <div className="mt-8 flex flex-wrap gap-3">
            <a
              className="button-primary"
              href={tool.liveUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              Open Live Tool
            </a>
            <a
              className="button-secondary"
              href={tool.url}
              rel="noopener noreferrer"
              target="_blank"
            >
              View Source Repository
            </a>
            <Link className="button-secondary" href="/">
              Back to Toolkit
            </Link>
          </div>
        </article>
      </div>
    </main>
  );
}
