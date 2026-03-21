import AdarRoutesPage from "@/components/adar-routes-page";
import adarRouteData from "@/data/adar-routes.json";
import "./styles.css";

export const metadata = {
  title: "ADAR Routes | ZHU Controller Toolkit",
  description: "Search adapted departure and arrival routes between airport pairs.",
};

export default function AdarRoutesToolPage() {
  return <AdarRoutesPage data={adarRouteData} />;
}

