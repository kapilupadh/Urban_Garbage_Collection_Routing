# Test and fix log


Run date: 22 November 2026. Scope included the FastAPI backend, solver, fleet planner, exported browser demo, and Next.js dashboard.

| Task | Finding and fix | Verification |
| --- | --- | --- |
| Baseline inspection | The backend already had a directed Chinese Postman solver. Its four original tests passed. The root browser demo still used a fixed six-node graph. The Next.js view hard-coded a 5 km area, had tiles disabled, and exposed create-only forms. The existing lint command prompted for setup. | Ran the original Python tests, production build, lint command, and inspected both browser entry points. |
| Browser demo | Replaced the synthetic entry point with a launcher for the exported Next.js interface. FastAPI now serves the demo and its static assets. Both browser entry points call the same backend route endpoint. | Built the static demo, followed the launcher in headless Chrome, and loaded the Next.js development dashboard across origins. |
| Live map and place selection | Added an OpenStreetMap basemap with attribution, Photon place search with a configurable endpoint and query cache, and a configurable area half-width. Added map-based area selection. Kept disconnected roads and isolated road loops in the graph so the solver can account for coverage exclusions. Removed isolated nodes without road edges before snapping. | Exercised search and selection with a Photon response fixture. Fed a controlled Overpass response through OSMnx's real graph construction and checked one-way direction, geometry, and edge counts. Chrome loaded and decoded real OpenStreetMap tiles. The fixture also checked a disconnected one-way loop and its exclusion count. The dashboard also rendered loaded roads when tile requests failed. |
| Depot and bins | Added map-based depot and bin placement plus coordinate inputs. The depot snaps to a road in a closed driving component. Fixed an overlapping depot marker consuming clicks in bin-placement mode. Bins beyond the loaded area remain unassigned, and a failed network download preserves the previous loaded network and route. | Verified map clicks in Chrome, including placing a bin directly on the depot marker, snapped depot coordinates through the API, a rejected out-of-area depot, a distant bin report, and state preservation after a provider failure. |
| Fleet and input management | Added editing and removal for bins and trucks, route invalidation when inputs change, positive demand and capacity validation, and stable IDs. Serialized changes to the shared simulation state to prevent record overwrites. | Exercised add, edit, delete, and selection through the UI or API. Tested 150 concurrent truck creations with unique IDs. Checked recovery after deleting a truck, validation errors, and optimization control when no trucks are selected. |
| Chinese Postman solver | Kept the exact min-cost-flow solver for directed roads and the exact matching solver for undirected graphs. Added independent cost checks using exhaustive edge-coverage search on small multigraphs. | Checked directed closure, parallel arcs, four odd-degree nodes, a self-loop, invalid lengths, disconnected graphs, and the original 1,960 m reference case. |
| Capacity planning | Replaced the quadratic search over candidate trip breaks with a heap-based search of the same choices. Exposed per-trip geometry, stop order, distance, and demand. | Matched extra distance and trip count against exhaustive breakpoints. Verified decimal loads, closed trips, oversized bins, bins on roads without a depot return, coverage-only routes, and distance reconciliation. |
| Trip playback | Added trip-specific playback, pause and seek controls, and a moving marker over the planned geometry. | Chrome verified two capacity-limited trips, activation of replay, marker placement, pause, seek, and closing playback. Also checked a 390 px viewport and captured browser runtime errors. |
| Benchmark | Exercised the supported minimum and maximum benchmark sizes. | The seeded 10-bin and 1,000-bin runs collected every bin with zero capacity violations. Both covered 6,240 directed edges. Fleet distance was 624,000 m and 907,600 m, respectively. The postman circuit was 624,000 m in both runs. |
| Real-road routing | Ran the production graph loader and optimizer on a small OpenStreetMap extract downloaded for Panaji, Goa. The extract was passed through the road-loader test adapter after filtering for drivable ways. | The graph had 29 nodes and 58 directed edges, all covered. All 12 bins were visited once, collecting 24 kg in four depot trips. The Postman circuit was 8,390.524 m and the fleet traveled 10,755.064 m. [Panaji map](https://www.openstreetmap.org/#map=17/15.4916/73.8285) |
| Build and tooling | Added Next.js lint configuration, a type-check command, and a browser export command. Corrected a Tailwind selector that caused a circular utility error. Python bytecode compilation needed a writable cache path in this sandbox. | Ran a clean dependency install, lint, TypeScript checks, production build, demo build, Python compilation, and `git diff --check`. |
| External reachability | The configured shell proxy refused connections. Direct Photon and Overpass probes timed out. The standard OpenStreetMap tile endpoint returned HTTP 200. | The live geocoding and road-download workflow still needs an end-to-end run on a network that can reach both providers. Results from fixture-based browser and API runs are recorded above. |

## Reproduce local checks

```bash
cd backend
python -m unittest discover -s tests -v
```

```bash
cd frontend
npm ci
npm run lint
npm run typecheck
npm run build
npm run build:demo
```

The backend suite ran 11 tests. For the browser workflow, the test server supplied a Photon-style place result, then ran the normal API with both a controlled Overpass-format fixture and the authentic Panaji extract. Headless Chrome verified the production export at `/demo` with real tiles and the Next.js development route at port 3000 with tile requests blocked. The [README](README.md) contains launch instructions and the model's scope.
