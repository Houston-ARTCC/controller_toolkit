import fs from "node:fs";
import path from "node:path";
import { parse } from "node-html-parser";

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function cleanText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function parseTable(tableEl, tableIndex, sectionId) {
  const headerCells = tableEl.querySelectorAll("thead th");
  const headerTexts = headerCells.map((cell) => cleanText(cell.textContent || ""));
  const hasSingleTitleHeader = headerTexts.length === 1;

  const title =
    hasSingleTitleHeader && headerTexts[0]
      ? headerTexts[0]
      : `Table ${tableIndex + 1}`;

  const columns = hasSingleTitleHeader
    ? []
    : headerTexts.filter((header) => header.length > 0);

  const entries = tableEl.querySelectorAll("tbody tr").map((row, rowIndex) => {
    const cells = row.querySelectorAll("td").map((cell, cellIndex) => ({
      id: `${sectionId}-t${tableIndex + 1}-r${rowIndex + 1}-c${cellIndex + 1}`,
      html: cell.innerHTML.trim(),
      text: cleanText(cell.textContent || ""),
    }));

    return {
      id: `${sectionId}-t${tableIndex + 1}-r${rowIndex + 1}`,
      cells,
    };
  });

  return {
    id: `${sectionId}-table-${tableIndex + 1}`,
    title,
    columns,
    entries,
  };
}

function findSectionContent(button) {
  const directSibling = button.nextElementSibling;
  const directClass = directSibling?.getAttribute?.("class") || "";
  if (directSibling?.tagName === "DIV" && directClass.split(/\s+/).includes("content")) {
    return directSibling;
  }

  const parentSibling = button.parentNode?.nextElementSibling;
  const parentClass = parentSibling?.getAttribute?.("class") || "";
  if (parentSibling?.tagName === "DIV" && parentClass.split(/\s+/).includes("content")) {
    return parentSibling;
  }

  return null;
}

function main() {
  const rootDir = process.cwd();
  const sourcePath = path.join(rootDir, "data", "alias-guide-markup.html");
  const targetPath = path.join(rootDir, "data", "alias-guide.json");
  const sourceHtml = fs.readFileSync(sourcePath, "utf8");
  const doc = parse(`<div id="alias-root">${sourceHtml}</div>`);
  const root = doc.querySelector("#alias-root");

  if (!root) {
    throw new Error("Could not parse alias guide markup.");
  }

  const title = cleanText(root.querySelector("h2")?.textContent || "Alias Guide");
  const topParagraphs = root.querySelectorAll(":scope > p");
  const updated = cleanText(
    topParagraphs.find((p) => cleanText(p.textContent || "").toLowerCase().startsWith("updated:"))
      ?.textContent || "",
  );

  const sections = [];
  const collapsibles = root.querySelectorAll("button.collapsible");

  collapsibles.forEach((button, sectionIndex) => {
    const rawTitle = cleanText(button.textContent || "");
    const sectionTitle = rawTitle.replace(/^>\s*/, "");
    const sectionId = `section-${slugify(sectionTitle)}-${sectionIndex + 1}`;
    const content = findSectionContent(button);

    const intro = [];
    const tables = [];

    if (content) {
      content.querySelectorAll("p").forEach((paragraph, paragraphIndex) => {
        intro.push({
          id: `${sectionId}-intro-${paragraphIndex + 1}`,
          html: paragraph.innerHTML.trim(),
          text: cleanText(paragraph.textContent || ""),
        });
      });

      content.querySelectorAll("table").forEach((table, tableIndex) => {
        tables.push(parseTable(table, tableIndex, sectionId));
      });
    }

    sections.push({
      id: sectionId,
      title: sectionTitle,
      intro,
      tables,
    });
  });

  const output = {
    meta: {
      title,
      updated,
      migratedAt: new Date().toISOString(),
      sourceFile: "data/alias-guide-markup.html",
    },
    sections,
  };

  fs.writeFileSync(targetPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Wrote ${targetPath}`);
}

main();
