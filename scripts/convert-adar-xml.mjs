import fs from "node:fs/promises";

function decodeXmlEntities(value) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractSingle(text, pattern) {
  const match = text.match(pattern);
  return match ? decodeXmlEntities(match[1].trim()) : "";
}

function extractMultiple(text, pattern) {
  const values = [];
  let match = pattern.exec(text);
  while (match) {
    values.push(decodeXmlEntities(match[1].trim()));
    match = pattern.exec(text);
  }
  pattern.lastIndex = 0;
  return values;
}

function extractListValues(text, blockTag, valueTag) {
  const blockPattern = new RegExp(`<${blockTag}>([\\s\\S]*?)<\\/${blockTag}>`, "g");
  const valuePattern = new RegExp(`<${valueTag}>([^<]+)<\\/${valueTag}>`, "g");
  const values = [];
  let blockMatch = blockPattern.exec(text);

  while (blockMatch) {
    const block = blockMatch[1];
    let valueMatch = valuePattern.exec(block);
    while (valueMatch) {
      values.push(decodeXmlEntities(valueMatch[1].trim()));
      valueMatch = valuePattern.exec(block);
    }
    valuePattern.lastIndex = 0;
    blockMatch = blockPattern.exec(text);
  }

  return values;
}

function parseRecord(recordXml) {
  const routeBlock = extractSingle(recordXml, /<ADARAutoRouteAlphas>([\s\S]*?)<\/ADARAutoRouteAlphas>/);
  const routeString =
    extractSingle(routeBlock, /<RouteString>([\s\S]*?)<\/RouteString>/) ||
    extractSingle(routeBlock, /<SilentRouteString>([\s\S]*?)<\/SilentRouteString>/);

  const departures = extractListValues(recordXml, "ADARDepartureList", "AirportID");
  const arrivals = extractListValues(recordXml, "ADARArrivalList", "AirportID");

  const criteriaBlocks =
    recordXml.match(/<ADARACClassCriteriaList>[\s\S]*?<\/ADARACClassCriteriaList>/g) || [];
  const aircraftCriteriaDetails = criteriaBlocks.map((block) => ({
    id: extractSingle(block, /<AircraftClassCriteriaID>([^<]+)<\/AircraftClassCriteriaID>/),
    facility: extractSingle(block, /<AircraftClassCriteriaFac>([^<]+)<\/AircraftClassCriteriaFac>/),
    isExcluded:
      extractSingle(block, /<IsExcluded>([^<]+)<\/IsExcluded>/).toLowerCase() === "true",
  }));

  return {
    adarId: extractSingle(recordXml, /<ADAR_ID>([^<]+)<\/ADAR_ID>/),
    order: Number.parseInt(extractSingle(recordXml, /<Order>([^<]+)<\/Order>/), 10) || 0,
    upperAltitude: Number.parseInt(extractSingle(recordXml, /<UpperAltitude>([^<]+)<\/UpperAltitude>/), 10) || 0,
    lowerAltitude: Number.parseInt(extractSingle(recordXml, /<LowerAltitude>([^<]+)<\/LowerAltitude>/), 10) || 0,
    autoRouteLimit: Number.parseInt(extractSingle(recordXml, /<AutoRouteLimit>([^<]+)<\/AutoRouteLimit>/), 10) || 0,
    routeString,
    departures,
    arrivals,
    routeFixes: extractMultiple(recordXml, /<FixName>([^<]+)<\/FixName>/g),
    aircraftCriteria: aircraftCriteriaDetails.map((entry) => entry.id),
    aircraftCriteriaDetails,
  };
}

async function main() {
  const inputPath = process.argv[2] || "H:/Shared drives/ZHU Staff/Facilities Department/FAA Provided Docs and Info/ZHU_ERAM/ADAR.xml";
  const outputPath = process.argv[3] || "data/adar-routes.json";

  const xml = await fs.readFile(inputPath, "utf8");
  const recordMatches = xml.match(/<ADARRecord>[\s\S]*?<\/ADARRecord>/g) || [];
  const routes = recordMatches.map(parseRecord).filter((record) => record.adarId && record.routeString);

  const airportSet = new Set();
  for (const route of routes) {
    for (const departure of route.departures) {
      airportSet.add(departure);
    }
    for (const arrival of route.arrivals) {
      airportSet.add(arrival);
    }
  }

  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      sourcePath: inputPath,
      routeCount: routes.length,
      airportCount: airportSet.size,
    },
    airports: Array.from(airportSet).sort(),
    routes,
  };

  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`Wrote ${routes.length} routes to ${outputPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});
