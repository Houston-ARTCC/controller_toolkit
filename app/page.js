import ToolkitHome from "@/components/toolkit-home";
import { getTools } from "@/lib/tools";

export default function Home() {
  const tools = getTools();

  return <ToolkitHome tools={tools} />;
}
