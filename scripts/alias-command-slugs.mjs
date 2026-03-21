import fs from "node:fs";
import path from "node:path";

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function commandBaseSlug(entry) {
  const firstCell = entry.cells?.[0]?.text || "";
  const firstToken = firstCell.trim().split(/\s+/)[0] || "";
  const stripped = firstToken.replace(/^\.+/, "");
  const slug = slugify(stripped);
  return slug || "entry";
}

function shortenIds(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const seen = new Map();

  for (const section of data.sections || []) {
    section.id = String(section.id || "").replace(/^s-/, "");

    for (let i = 0; i < (section.intro || []).length; i += 1) {
      section.intro[i].id = `${section.id}-intro-${i + 1}`;
    }

    for (let t = 0; t < (section.tables || []).length; t += 1) {
      const table = section.tables[t];
      table.id = `${section.id}-table-${t + 1}`;

      for (const entry of table.entries || []) {
        const base = commandBaseSlug(entry);
        const count = (seen.get(base) || 0) + 1;
        seen.set(base, count);
        const entryId = count === 1 ? base : `${base}-${count}`;

        entry.id = entryId;
        entry.cells = (entry.cells || []).map((cell, index) => ({
          ...cell,
          id: `${entryId}-c${index + 1}`,
        }));
      }
    }
  }

  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

const target = path.join(process.cwd(), "data", "alias-guide.json");
shortenIds(target);
console.log(`Wrote short command slugs to ${target}`);
