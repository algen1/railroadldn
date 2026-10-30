# Railroom

Live London TfL interactive map. Work in progress.

A 3D map of London with live Tube, Elizabeth line, London Overground, and DLR trains.

TfL does not publish GPS for these trains. Railroom reads the live arrival feed, which says where a train is in words ("at Paddington", "between Oxford Circus and Bond Street") and when it will reach the next stations. Each train is placed on the real route geometry and glides toward the next update.

Click a train to see its destination, the latest location text, and the upcoming stops with expected arrival times.

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
