import Link from "next/link";

export default function NotFound() {
  return (
    <main className="relative min-h-screen overflow-hidden px-6 py-10 md:px-10">
      <div className="ambient-bg" />
      <div className="mx-auto max-w-4xl">
        <section className="panel">
          <p className="text-accent text-sm font-semibold uppercase tracking-[0.24em]">
            404
          </p>
          <h1 className="font-heading text-main mt-2 text-5xl font-bold tracking-wide md:text-6xl">
            Tool Not Found
          </h1>
          <p className="text-muted mt-3 text-lg">
            This route does not map to a tool entry yet.
          </p>
          <Link className="button-primary mt-8 inline-flex" href="/">
            Return to Toolkit
          </Link>
        </section>
      </div>
    </main>
  );
}
