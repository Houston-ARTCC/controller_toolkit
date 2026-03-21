import fs from "node:fs/promises";

function normalizeAirport(code) {
  const trimmed = (code || "").trim().toUpperCase();
  if (!trimmed) {
    return "";
  }
  return trimmed.startsWith("K") ? trimmed : `K${trimmed}`;
}

function parseVariantLine(line) {
  const match = line.trim().match(/^<([^>]+)>\s*(.+)$/);
  if (!match) {
    return null;
  }

  return {
    label: match[1].trim(),
    route: match[2].trim(),
  };
}

async function main() {
  const inputPath =
    process.argv[2] ||
    "H:/Shared drives/ZHU Staff/Facilities Department/vNAS Alias/ZHU Aliases.txt";
  const outputPath = process.argv[3] || "data/zhu-routing-rules.json";

  const raw = await fs.readFile(inputPath, "utf8");
  const lines = raw.split(/\r?\n/);

  const sectionHeaders = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (/^; ---[A-Z0-9\-/& ]+---\s*$/.test(lines[i])) {
      sectionHeaders.push({ lineNumber: i + 1, text: lines[i] });
    }
  }

  const routingHeader = sectionHeaders.find((entry) => entry.lineNumber > 30000 && entry.text === "; ---ROUTING---");
  const loaHeader = sectionHeaders.find((entry) => entry.lineNumber > (routingHeader?.lineNumber || 0) && entry.text === "; ---LOA RECALL---");

  if (!routingHeader || !loaHeader) {
    throw new Error("Could not locate ROUTING section boundaries in alias file.");
  }

  const start = routingHeader.lineNumber;
  const end = loaHeader.lineNumber - 1;
  const sectionLines = lines.slice(start, end);

  const records = [];
  for (const line of sectionLines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(".")) {
      continue;
    }

    const recordMatch = trimmed.match(/^\.(\S+)\s+\.note\s+([A-Z0-9]{3,5})\s+TO\s+([A-Z0-9]{3,5})\s+ROUTING\\n\s*(.+)$/i);
    if (!recordMatch) {
      continue;
    }

    const alias = `.${recordMatch[1].toLowerCase()}`;
    const departure = normalizeAirport(recordMatch[2]);
    const arrival = normalizeAirport(recordMatch[3]);
    const rawBody = recordMatch[4];

    const variantLines = rawBody
      .split("\\n")
      .map((segment) => segment.trim())
      .filter(Boolean);

    const variants = variantLines
      .map(parseVariantLine)
      .filter(Boolean);

    records.push({
      alias,
      departure,
      arrival,
      variants,
      rawBody,
    });
  }

  const airports = Array.from(
    new Set(records.flatMap((record) => [record.departure, record.arrival])),
  ).sort();

  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      sourcePath: inputPath,
      sectionStartLine: start,
      sectionEndLine: end,
      recordCount: records.length,
      airportCount: airports.length,
    },
    airports,
    routes: records,
  };

  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`Wrote ${records.length} route records to ${outputPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});

