import tools from "@/data/tools.json";

export function getTools() {
  return tools;
}

export function getToolById(id) {
  return tools.find((tool) => tool.id === id);
}

export function getToolCategories() {
  return [...new Set(tools.map((tool) => tool.category))];
}
