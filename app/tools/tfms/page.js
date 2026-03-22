import TfmsViewerPage from "@/components/tfms-viewer-page";
import "./styles.css";

export const metadata = {
  title: "TFMS | ZHU Controller Toolkit",
  description:
    "Live ZHU traffic flow summaries with specialty and split projections from VATSIM data.",
};

export default function TfmsToolPage() {
  return <TfmsViewerPage />;
}
