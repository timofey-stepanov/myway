# MyWay

A vibe-coded paragliding track visualization app.

## Deployed Version
The app is deployed and available at:
**[myway.timofeystepanov.com](https://myway.timofeystepanov.com)**

## Architecture & Privacy
- **Static App**: Built with pure HTML, CSS, and client-side JavaScript.
- **Local Storage**: All flight tracks and settings are stored entirely in your browser using IndexedDB and localStorage. No data is sent to a backend server.

## Features
- **IGC Parser**: Parses `.igc` track logs directly in the browser.
- **Terrain Map**: MapLibre GL JS integration supporting light and dark terrain basemaps.
- **Scoring**: Calculates FAI triangles, Flat triangles, and 5-point open distance scoring metrics.
- **Flight Simulator**: Replays tracks with customizable speed and telemetry instruments (altitude, speed, climb/sink, L/D).

## Running Locally
To run the app locally, start a local HTTP server:
```bash
python3 -m http.server 8000
```
Then open **[http://localhost:8000](http://localhost:8000)** in your browser.
