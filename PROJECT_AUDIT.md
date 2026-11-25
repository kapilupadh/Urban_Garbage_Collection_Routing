# Urban Garbage Collection Routing audit

**26 November 2026** · Current local project, including uncommitted app code

The Chinese Postman solver passed the routing checks. The main classroom-demo blocker is the live road download. The dashboard also has two reproducible workflow bugs. For a shared deployment, the dependency advisories and missing access controls take priority.

## Confirmed failures and security gaps

| Priority | Finding | Evidence and impact | Suggested fix |
| --- | --- | --- | --- |
| High for the demo | Live road downloads fail on this connection | Live Photon search returned Panaji. Loading a 500 m half-width area through the default Overpass provider returned HTTP 502 from the app after the provider timed out. A previous run also received an upstream overload response, and the backup timed out. An empty session cannot compute a live route until roads load. [Road loader](backend/app/services/road_network.py#L116) · [API handler](backend/app/api.py#L83) | Bundle a small, attributed OpenStreetMap extract or deterministic sample as a selectable offline demo. Add a bounded retry and a clear provider status message. |
| Critical package rating | Frontend lockfile contains known-vulnerable dependencies | `npm audit` flagged **6 package entries** (1 critical, 4 high, 1 moderate). `npm audit --omit=dev` flagged **2 package entries**, Next.js **14.2.35** and its nested PostCSS **8.4.31**. These are scanner ratings. Applicability depends on which Next.js features run. The FastAPI-hosted export serves static files without a Next.js server. [Next.js advisory](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4) · [PostCSS advisory](https://github.com/advisories/GHSA-6g55-p6wh-862q) · [Frontend lockfile](frontend/package-lock.json) | Upgrade to a supported, patched Next.js release, update its lint tooling and lockfile, then repeat both scans and both build modes. |
| High for deployment | Backend dependencies have known advisories | `pip-audit` reported **74 advisories in 7 of 51 installed packages**. A separate OSV query flagged the same seven packages. All seven affected versions also resolved in the fresh Python 3.9 environment. The repository allows dependency version ranges. [Backend requirements](backend/requirements.txt) · [Starlette advisory example](https://github.com/Kludex/starlette/security/advisories/GHSA-86qp-5c8j-p5mr) | Resolve and lock patched versions on a supported Python release. Test FastAPI and Starlette upgrades together, then rescan. |
| High for deployment | The tested Python runtime is end-of-life | The machine used Python **3.9.6**. The Python 3.9 series ended security support in October 2025, and urllib3 warned about the machine's LibreSSL build during the test. [Python version support](https://devguide.python.org/versions/#unsupported-versions) | Document and test setup with a supported Python release and a compatible OpenSSL build. |
| High if shared | API has no authentication or project isolation | The API exposes read and write operations without a user or ownership check. Bins, trucks, the depot, roads, and the last route share one process-wide state. CORS preflights allowed the two configured localhost origins and rejected an unrelated origin, as configured. [API routes and shared state](backend/app/api.py#L29) · [CORS configuration](backend/app/main.py#L14) | Bind locally for the single-user demo. For shared deployment, add authentication, per-project authorization, and separate stored state. |
| High if shared | Expensive operations lack application-level resource limits | Source review found no per-client rate limit, request-body cap, or explicit graph-size limit. Road loads can cover a 50 km half-width, and optimization and network geometry reads hold the shared lock. The selected ID lists have no maximum length. [API handlers](backend/app/api.py#L75) · [Request schemas](backend/app/schemas.py#L54) | Set request and workload limits before deployment. Cap graph and response sizes and apply a concurrency limit or job queue for expensive operations. |
| Medium | Dashboard loses the visible route on refresh | In Chrome, refreshing hid **Route results** while `GET /api/routes` still returned the same route. The dashboard restored bins, trucks, and roads. Initialization never requests the existing route and reselects all listed trucks. [Dashboard initialization](frontend/components/Dashboard.tsx#L49) · [Routes endpoint](backend/app/api.py#L248) | Restore the saved route and its truck selection when reopening the dashboard. |
| Medium | A drawn route can intercept bin placement | In Chrome, with **Pick bin on map** active and a route crossing the depot, clicking the depot opened the route popup and left the bin form closed. Clicking clear map background opened the form. [Map overlays and popups](frontend/components/RouteMap.tsx#L98) | Let placement clicks reach the map when a pick mode is active. Add a regression check with the depot, a bin marker, and a drawn route overlapping. |
| Medium | Simulator inputs and routes have no persistent storage | A bin created in one backend process disappeared after a fresh process started. Source review found that trucks, the depot, loaded roads, and route results also live in memory. Separate workers would have independent state. [Default data](backend/app/services/data.py) · [API state](backend/app/api.py#L29) | Persist the simulation or support saving and reloading a demo snapshot. |
| Medium if shared | Missing browser security headers and raw provider diagnostics | HTTP responses for the launcher, dashboard, docs, OpenAPI schema, and API health lacked CSP, framing protection, `X-Content-Type-Options`, `Referrer-Policy`, and `Permissions-Policy`. The live HTTP 502 also exposed the upstream hostname and connection error in the response body. [App configuration](backend/app/main.py) · [Provider error handlers](backend/app/api.py#L59) | Set response headers for the deployed app, use HTTPS for shared hosting, and return a short public error while logging provider details server-side. |
| Medium for accessibility | Depot relocation requires a map pointer | Source review found that the **Move depot** button activates a map-click mode. The dashboard has coordinate fields for bins and no equivalent depot fields. [Depot controls](frontend/components/Dashboard.tsx#L211) · [Map click handler](frontend/components/RouteMap.tsx#L31) | Provide keyboard-accessible depot latitude and longitude inputs. |
| Low for the demo | Tile display differed between the browser and a direct request | The Chrome smoke test decoded zero basemap tiles. A separate direct request returned HTTP 200 with a PNG. The fixture roads and route still rendered, so the browser tile result is environment-dependent. [Tile configuration](frontend/components/RouteMap.tsx#L92) | Test tile rendering on the demonstration machine and add a tile-loading status if the blank basemap persists. |

## Backend dependency scan

| Installed package | Version | Advisories reported by pip-audit |
| --- | --- | ---: |
| Pillow | 11.3.0 | 59 |
| Starlette | 0.49.3 | 5 |
| urllib3 | 2.6.3 | 5 |
| AnyIO | 4.12.1 | 2 |
| GeoPandas | 0.14.4 | 1 |
| python-dotenv | 1.2.1 | 1 |
| Requests | 2.32.5 | 1 |

Prioritize the packages that serve HTTP or process provider responses. The scanner also flags libraries that may only be used indirectly or for features the app never calls. A package flag confirms a version match, with application exposure evaluated separately. [OSV advisory database](https://osv.dev/)

## Checks that passed

| Area | Result |
| --- | --- |
| Backend suite | **11 of 11 passed** in both the existing environment and a freshly installed virtual environment. Covers provider fixtures, failed network reload preserving state, bin/truck operations, 150 concurrent truck creations, route feasibility, decimal loads, and benchmark boundaries. |
| Chinese Postman optimality | **200 additional seeded graphs matched a brute-force minimum-distance check.** The sample included 100 directed and 100 undirected multigraphs. Every route closed at the depot and covered every edge in its input graph. |
| Teacher’s Chinese Postman-only demonstration | With one truck and no bins, the fixture produced one closed 1.20 km circuit, covered all eight eligible directed edges, and reported three disconnected edges. The displayed fleet and Postman distances were equal. Capacity-based trip splitting is a separate stage in the full simulator. |
| Capacity routing | Chrome showed two trips for a 1 kg truck serving two 1 kg bins. Replay, pause, seek, and close worked. Tests verified that completed trips return to the depot and that out-of-area or oversized bins are reported. |
| Synthetic performance | With 10 or 1,000 bins, all 6,240 directed road edges and all bins were covered with zero reported capacity violations. Solver execution took about 165 ms and 929 ms in these runs. With truck capacity below bin demand, ten bins were reported as unassigned and road coverage was preserved. |
| Input validation | Eight invalid payloads covering coordinates, demand, capacity, naming, road-area bounds, and benchmark bounds returned HTTP 422. Existing tests cover additional invalid inputs and missing IDs. |
| Frontend and API smoke checks | Lint, TypeScript checks, the production build, and the static export passed. A clean `npm ci`, production build, and startup also passed in a temporary copy. The launcher, dashboard, API docs, API schema, and health endpoint returned HTTP 200. Chrome verified fixture place search and road loading, depot movement, bin/truck creation, editing and removal, and no uncaught page errors. No horizontal overflow was measured at 320 or 390 px. |
| Secrets and dependency integrity | A working-tree pattern scan returned no matches for common private keys and access-token formats. `pip check` found no broken installed requirements. |

## Repeat the main checks

Run `python3 -m unittest discover -s tests -v` and `python3 -m pip check` in `backend/` with the backend environment active and `httpx` installed. Run `npm run lint`, `npm run typecheck`, `npm run build`, and `npm run build:demo` in `frontend/`.

Use `npm audit` and `npm audit --omit=dev` with the frontend lockfile. For Python, scan a fully resolved backend environment with `python -m pip_audit` after installing the scanner. Advisory results can change as the databases update. [README setup steps](README.md#44-running-and-testing-the-application)

## Coverage limits

- Tested on macOS using Python 3.9.6, Node.js 26.13.0, and desktop Chrome with two narrow viewports. Safari, Firefox, physical phones, and hosted reverse-proxy settings were outside this run.
- The live road provider failure prevented timing a fresh real-road route and exercising the largest selectable area. The fixture, brute-force comparisons, and synthetic benchmarks cover the routing logic independently of that provider.
- Package scans report advisories associated with installed or locked versions. The tests evaluated configuration and normal application behavior. Runtime exposure to individual package advisories remains unverified.
- The report covers the running simulator and its source and dependencies. The presentation and assignment PDF were outside the application audit.
