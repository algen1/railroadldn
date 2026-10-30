# Railroom

Live London TfL interactive map. Work in progress.

A 3D map of London with live Tube, Elizabeth line, London Overground, and DLR trains.

TfL does not publish GPS for these trains. Railroom reads the live arrival feed, which says where a train is in words ("at Paddington", "between Oxford Circus and Bond Street") and when it will reach the next stations. Each train is placed on the real route geometry and glides toward the next update.

Click a train to see its destination, the latest location text, and the upcoming stops with expected arrival times.

The journey planner defaults to **Leave now**. A search automatically centres on the next suitable train to reach your boarding station, hides every other train and unrelated TfL route lines, and adds a clickable **Catch this train** marker at its live position. The marker follows the animated train and opens its details. If no suitable live prediction is available, the planner waits for the feed to refresh. Station search suggestions include line names and colours.

**Arrive by** accepts an arrival date and time in London time. Routes, changes, departure times, and disruptions come from TfL Journey Planner. Select a journey to highlight it on the map. The latest departure that meets the arrival deadline is selected first.

**Leave now** chooses the earliest suitable live arrival at the boarding station, requiring predictions for both ends of the train leg in the correct order. Walking time is measured from the search, and journeys with changes require enough time to walk to the next planned departure. **Arrive by** matches predictions close to the planned departure and within the planned arrival deadline. Future journeys show scheduled departures until matching live predictions are available. Click a live departure time or its live train card to isolate that train on the map and see its current reported location and boarding prediction. Other trains and lines stay hidden until you choose Show full map, close the train panel, or return to the planner. Your previous map layer choices are restored. If a selected train is missing from a feed refresh, its last reported position stays visible with a clear waiting-for-update label; it is never replaced by a different service. Searching in Leave now keeps other trains and unrelated route lines hidden while the live match is pending. Live predictions refresh with the train feed; search again to refresh the route itself.

The isolated map shows the journey route in each line’s TfL colour, boarding and destination labels, and change stations naming the next line. Walking connections are dashed. The glass-style interface uses translucent panels, rounded controls and blur, with reduced-transparency and reduced-motion fallbacks.

See [CHANGELOG.md](CHANGELOG.md) for the latest changes.

## Checks

```bash
npm run build
npm run lint
node scripts/test-journey.mjs
node scripts/test-train-selection.mjs
```

## Run

```bash
npm install
npm run dev
```

Open the URL Vite prints. The map needs a network connection to TfL and to the basemap tiles.

An API key is optional for light use. Register one at [TfL's API portal](https://api-portal.tfl.gov.uk/) and put it in `.env`:

```bash
VITE_TFL_APP_KEY=your_key
```

## Stack

Vite, React, TypeScript, MapLibre, and Three.js. Line colours follow the TfL colour standard.

## Data

Powered by TfL Open Data. This project is not endorsed by Transport for London.

Basemap © [OpenFreeMap](https://openfreemap.org/) and OpenStreetMap contributors.
