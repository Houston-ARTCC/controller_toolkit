import RouteValidatorPage from "@/components/route-validator-page";
import routeData from "@/data/zhu-routing-rules.json";
import "./styles.css";

export const metadata = {
  title: "Route Validator | ZHU Controller Toolkit",
  description:
    "Validate VATSIM flight plan routes against ZHU preferred routing aliases for controlled departures.",
};

export default function RouteValidatorToolPage() {
  return <RouteValidatorPage routeData={routeData} />;
}

