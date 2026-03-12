import ToolkitHome from "@/components/toolkit-home";
import { getToolCategories, getTools } from "@/lib/tools";

export default function Home() {
  const tools = getTools();
  const categories = getToolCategories();

  return <ToolkitHome tools={tools} categories={categories} />;
}
