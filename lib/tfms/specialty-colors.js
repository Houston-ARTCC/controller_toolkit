const SPECIALTY_PALETTE = {
  AUS: { sectorFill: "#FFDAE1", iconFill: "#F39AB0", iconStroke: "#FFE8ED" },
  CRP: { sectorFill: "#FFDDD1", iconFill: "#F1A98F", iconStroke: "#FFEAE3" },
  LCH: { sectorFill: "#C7F7C7", iconFill: "#72C57A", iconStroke: "#DEFBDD" },
  LFK: { sectorFill: "#EBDFEB", iconFill: "#BA9CC9", iconStroke: "#F3EBF3" },
  NEW: { sectorFill: "#FEFCE5", iconFill: "#D8D08A", iconStroke: "#FFFEEF" },
  OCN: { sectorFill: "#A6DAF0", iconFill: "#5CA9CF", iconStroke: "#C6E8F6" },
  RSG: { sectorFill: "#D2C6EC", iconFill: "#9E86C9", iconStroke: "#E4DCF5" },
};

export function getSpecialtyColors(specialty) {
  const code = String(specialty || "").toUpperCase();
  return (
    SPECIALTY_PALETTE[code] || { sectorFill: "#A6DAF0", iconFill: "#5CA9CF", iconStroke: "#D4E8F1" }
  );
}

