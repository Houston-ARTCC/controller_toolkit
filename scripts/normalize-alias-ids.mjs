import fs from "node:fs";
import path from "node:path";

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function tableSlug(table, index) {
  const raw = table.title || `table-${index + 1}`;
  const slug = slugify(raw);
  if (!slug || /^table-\d+$/.test(slug)) {
    return `t${index + 1}`;
  }
  return slug;
}

function normalizeAliasIds(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);

  const sections = (data.sections || []).map((section, sectionIndex) => {
    const sectionSlug = slugify(section.title) || `section-${sectionIndex + 1}`;
    const sectionId = `s-${sectionSlug}`;

    const intro = (section.intro || []).map((item, introIndex) => ({
      ...item,
      id: `${sectionId}-i${introIndex + 1}`,
    }));

    const tables = (section.tables || []).map((table, tableIndex) => {
      const tSlug = tableSlug(table, tableIndex);
      const tableId = `${sectionId}-${tSlug}`;

      const entries = (table.entries || []).map((entry, entryIndex) => {
        const entryId = `${tableId}-r${entryIndex + 1}`;
        const cells = (entry.cells || []).map((cell, cellIndex) => ({
          ...cell,
          id: `${entryId}-c${cellIndex + 1}`,
        }));

        return {
          ...entry,
          id: entryId,
          cells,
        };
      });

      return {
        ...table,
        id: tableId,
        entries,
      };
    });

    return {
      ...section,
      id: sectionId,
      intro,
      tables,
    };
  });

  const updated = {
    ...data,
    sections,
  };

  fs.writeFileSync(filePath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
}

const target = path.join(process.cwd(), "data", "alias-guide.json");
normalizeAliasIds(target);
console.log(`Normalized IDs in ${target}`);
