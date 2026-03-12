import AliasGuidePage from "@/components/alias-guide-page";
import guideData from "@/data/alias-guide.json";
import "./styles.css";

export const metadata = {
  title: "Alias Guide | ZHU Controller Toolkit",
  description: "Searchable command reference for CRC aliases and controller workflows.",
};

export default function AliasGuideToolPage() {
  return <AliasGuidePage guideData={guideData} />;
}
