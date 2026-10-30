# Railroom

Live London TfL interactive map. Work in progress.

A 3D map of London with live Tube, Elizabeth line, London Overground, and DLR trains.

TfL does not publish GPS for these trains. Railroom reads the live arrival feed, which says where a train is in words ("at Paddington", "between Oxford Circus and Bond Street") and when it will reach the next stations. Each train is placed on the real route geometry and glides toward the next update.

Click a train to see its destination, the latest location text, and the upcoming stops with expected arrival times.

The journey planner defaults to **Leave now**. Choose departure and destination stations to find the next suitable live train. The map automatically centres on that train and shows only its line, hiding all other trains and TfL lines. For journeys with changes, this starts with the first train; live predictions must preserve the transfer time allowed by TfL. If no suitable live prediction is available, the planner waits for a match as the feed refreshes.

**Arrive by** accepts an arrival date and time in London time. Routes, changes, departure times, and disruptions come from TfL Journey Planner. Select a journey to highlight it on the map. The latest departure that meets the arrival deadline is selected first.

A live train is offered only when its predictions include both stops in the correct order, its departure is close to the planned departure, and it reaches the next change or destination by the planned arrival. Future journeys show scheduled departures until matching live predictions are available. Click a live departure time or its live train card to isolate that train on the map and see its current reported location and boarding prediction. Other trains and lines stay hidden until you choose Show full map, close the train panel, or return to the planner. Your previous map layer choices are restored. A missing live train is shown as temporarily unavailable rather than replaced by a different service. Live predictions refresh with the train feed; search again to refresh the route itself.

## Checks

```bash
npm run build
npm run lint
node scripts/test-journey.mjs
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
