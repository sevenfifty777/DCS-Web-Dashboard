# Graph Report - DCS-Web-Dashboard  (2026-08-28)

## Corpus Check
- 141 files · ~118,042 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1072 nodes · 2413 edges · 71 communities (53 shown, 18 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 16 edges (avg confidence: 0.81)
- Token cost: 122,547 input · 2,276 output

## Community Hubs (Navigation)
- Backend REST API Layer
- gRPC Proto Definitions
- Airboss Carrier Ops UI
- Auth & Session Management
- Docs Site JS Helpers
- Server Settings Lua Parser
- Frontend Dependencies
- mdBook Theme Logic
- gRPC Client Library
- Utility Pages UI
- SRS Integration Page
- Foothold Backend Logic
- mdBook Search Engine
- TypeScript Config
- Proto JSON Conversion
- Backend Config Module
- Axum Server Bootstrap
- Interactive Map Component
- SSE Streaming & Errors
- World Routes Backend
- Mission & Console API
- SRS Backend Routes
- Windows Session Launcher
- SSE Broadcast Stream
- Trigger & Marks Backend
- mdBook TOC Navigation
- Warehouse Routes Backend
- Mission API Routes
- Graveyard Wreck Tracker
- Foothold Page UI
- App Layout & Auth Gate
- Project Documentation
- Spawner Routes Backend
- Static Asset Embedding
- Foothold Config Page
- Weather API Routes
- Project Readme & Docs
- Settings API Routes
- ORBAT Page UI
- Weather Page UI
- Rust Build Script
- Events Page UI
- Home Page & Status
- Red Attacks Map
- Triggers API Routes
- Players Page UI
- Settings Page UI
- Tasks Manager Page
- Airbase Popup Component
- Unit Popup Component
- Atmosphere API Route
- Health Check API
- RDP Status API
- Atmosphere Page UI
- Radar Page UI
- CSAR Map Component
- Zone Details Map
- Chat API Route
- Players API Route
- Legacy Proxy Config
- Discord OAuth2 Docs
- API & CI Pipeline
- ESLint Configuration
- Next.js Configuration
- Features Documentation

## God Nodes (most connected - your core abstractions)
1. `AppState` - 102 edges
2. `AuthUser` - 77 edges
3. `errorMessage()` - 42 edges
4. `apiFetch()` - 27 edges
5. `err_detail()` - 24 edges
6. `unaryRequest()` - 17 edges
7. `compilerOptions` - 17 edges
8. `bad_request()` - 16 edges
9. `c()` - 13 edges
10. `m()` - 12 edges

## Surprising Connections (you probably didn't know these)
- `globalKeyHandler()` --calls--> `mdbook_something_else_has_focus()`  [INFERRED]
  docs/book/searcher-09f2665d.js → docs/book/book-609e4cb8.js
- `a()` --calls--> `t()`  [INFERRED]
  docs/book/mark-09e88c2c.min.js → docs/book/highlight-abc7f01d.js
- `e()` --calls--> `t()`  [INFERRED]
  docs/book/mark-09e88c2c.min.js → docs/book/highlight-abc7f01d.js
- `router()` --references--> `AppState`  [EXTRACTED]
  rust-web-dashboard/src/routes/mod.rs → rust-web-dashboard/src/state.rs
- `Architecture Overview` --references--> `Rust Backend`  [EXTRACTED]
  docs/book/architecture.html → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **DCS Integration Stack** — readme_dcs_grpc, readme_backend, readme_frontend [EXTRACTED 1.00]
- **Project Documentation** — docs_architecture, docs_configuration, docs_features, docs_api_grpc [EXTRACTED 1.00]
- **Core System Components** — rust_web_dashboard, web_dashboard, dcs_grpc_mod [EXTRACTED 1.00]
- **Windows Deployment Stack** — rust_web_dashboard, nssm, dcs_grpc_mod [EXTRACTED 0.90]

## Communities (71 total, 18 thin omitted)

### Community 0 - "Backend REST API Layer"
Cohesion: 0.05
Nodes (146): AxumPath, FootholdData, Multipart, destroy_unit_group(), get_airbases(), get_foothold_zones(), get_marks(), get_unit_details() (+138 more)

### Community 1 - "gRPC Proto Definitions"
Cohesion: 0.07
Nodes (96): Color, GetAirbaseParkingResponse, GetAirbaseRunwaysResponse, GetAirbasesResponse, GetAmmoResponse, GetBallisticsCountResponse, GetBannedPlayersResponse, GetBullseyeResponse (+88 more)

### Community 2 - "Airboss Carrier Ops UI"
Cohesion: 0.05
Nodes (65): AIRCRAFT_ICON_DEFINITIONS, AIRCRAFT_ICON_FILES, AircraftIconDefinition, aircraftIconForType(), AircraftIconSpec, expectedMappings, DeckId, DeckLaunchRoute (+57 more)

### Community 3 - "Auth & Session Management"
Cohesion: 0.08
Nodes (47): FromRequestParts, Parts, Redirect, Rejection, append_audit(), AuditLog, AuthError, AuthQuery (+39 more)

### Community 4 - "Docs Site JS Helpers"
Cohesion: 0.07
Nodes (19): o(), a(), b(), c(), d(), e(), I(), l() (+11 more)

### Community 5 - "Server Settings Lua Parser"
Cohesion: 0.17
Nodes (32): advanced_from_lua(), advanced_token(), bool_token(), escape_lua_string(), fetch_ip(), js_number_format(), js_string(), json_to_i64() (+24 more)

### Community 6 - "Frontend Dependencies"
Cohesion: 0.07
Nodes (29): dependencies, cookie, @grpc/grpc-js, @grpc/proto-loader, jsonwebtoken, leaflet, mgrs, next (+21 more)

### Community 7 - "mdBook Theme Logic"
Cohesion: 0.11
Nodes (13): fetch_with_timeout(), get_saved_theme(), get_theme(), handle_crate_list_update(), hideSidebar(), playground_text(), resize(), run_rust_code() (+5 more)

### Community 8 - "gRPC Client Library"
Cohesion: 0.08
Nodes (25): atmosphereClient, createClient(), credentials, customClient, DynamicClient, EvalResponse, HealthResponse, hookClient (+17 more)

### Community 9 - "Utility Pages UI"
Cohesion: 0.11
Nodes (7): AccessLog, FootholdPlayer, MissionData, DrawingEvents(), apiFetch(), clearToken(), setToken()

### Community 10 - "SRS Integration Page"
Cohesion: 0.13
Nodes (20): isRecord(), isSrsProcessResponse(), isSrsSettings(), responseError(), SrsProcessResponse, SrsSettings, SrsSettingValue, hasApiError() (+12 more)

### Community 11 - "Foothold Backend Logic"
Cohesion: 0.26
Nodes (22): Lua, flatten_lua_value(), FootholdAttack, FootholdConfigResponse, FootholdData, FootholdEjectedPilot, FootholdMetadata, FootholdMission (+14 more)

### Community 12 - "mdBook Search Engine"
Cohesion: 0.19
Nodes (20): mdbook_something_else_has_focus(), doSearch(), doSearchOrMarkFromUrl(), formatSearchMetric(), formatSearchResult(), globalKeyHandler(), hasFocus(), init() (+12 more)

### Community 13 - "TypeScript Config"
Cohesion: 0.10
Nodes (20): compilerOptions, allowImportingTsExtensions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib (+12 more)

### Community 14 - "Proto JSON Conversion"
Cohesion: 0.19
Nodes (17): DescriptorPool, DynamicMessage, M, inject_oneof_discriminators(), pool(), Result, String, Value (+9 more)

### Community 15 - "Backend Config Module"
Cohesion: 0.22
Nodes (12): Config, default_saved_games_dir(), DiscordConfig, normalize_endpoint(), optional(), Arc, Option, PathBuf (+4 more)

### Community 16 - "Axum Server Bootstrap"
Cohesion: 0.16
Nodes (14): Modify, OpenApi, executable_directory(), init_tracing(), main(), PathBuf, Result, shutdown_signal() (+6 more)

### Community 17 - "Interactive Map Component"
Cohesion: 0.12
Nodes (10): ActiveLaser, DrawingEventsProps, iconCache, MapAirbase, MapMark, MapUnit, MapZone, SpawnSettings (+2 more)

### Community 18 - "SSE Streaming & Errors"
Cohesion: 0.19
Nodes (9): GET(), errorCode(), serverStreamingRequest(), streamMissionEvents(), streamUnits(), AuditLog, getAuthLogs(), LOG_FILE (+1 more)

### Community 19 - "World Routes Backend"
Cohesion: 0.31
Nodes (14): err_resp(), grpc_error_returns_bad_gateway(), parking(), ParkingQuery, Json, Option, Path, Query (+6 more)

### Community 20 - "Mission & Console API"
Cohesion: 0.22
Nodes (10): POST(), GET(), getFiles(), POST(), execAsync, GET(), POST(), ScheduledTask (+2 more)

### Community 21 - "SRS Backend Routes"
Cohesion: 0.35
Nodes (13): err_500(), get_clients(), get_settings(), post_settings(), Json, Response, Result, State (+5 more)

### Community 22 - "Windows Session Launcher"
Cohesion: 0.23
Nodes (10): Drop, EnvBlockGuard, HandleGuard, launch_in_user_session(), Option, Result, String, Vec (+2 more)

### Community 23 - "SSE Broadcast Stream"
Cohesion: 0.35
Nodes (12): Receiver, broadcast_sse(), events_stream(), radar_stream(), Event, Infallible, Item, Result (+4 more)

### Community 24 - "Trigger & Marks Backend"
Cohesion: 0.35
Nodes (12): create_mark(), EffectPayload, err_resp(), MarkPayload, remove_mark(), Json, Option, Path (+4 more)

### Community 25 - "mdBook TOC Navigation"
Cohesion: 0.26
Nodes (7): drawDebugLine(), mdbookEnableThresholdDebug(), MDBookSidebarScrollbox, reloadCurrentHeader(), updateCurrentHeader(), updateHeaderExpanded(), updateThreshold()

### Community 26 - "Warehouse Routes Backend"
Cohesion: 0.35
Nodes (11): add_item(), add_liquid(), AddItemBody, AddLiquidBody, get_inventory(), InventoryQuery, Json, Query (+3 more)

### Community 27 - "Mission API Routes"
Cohesion: 0.35
Nodes (11): GET(), getServerSettings(), mutateMissionQueue(), POST(), getPaused(), hookEval(), loadMission(), reloadCurrentMission() (+3 more)

### Community 28 - "Graveyard Wreck Tracker"
Cohesion: 0.33
Nodes (7): Graveyard, Path, Result, Self, String, Vec, Wreck

### Community 29 - "Foothold Page UI"
Cohesion: 0.18
Nodes (9): DynamicCSARMap, DynamicRedAttacksMap, DynamicZoneDetailsMap, FootholdAttack, FootholdData, FootholdEjectedPilot, FootholdMission, FootholdPlayer (+1 more)

### Community 30 - "App Layout & Auth Gate"
Cohesion: 0.22
Nodes (4): metadata, viewport, AuthGate(), getToken()

### Community 31 - "Project Documentation"
Cohesion: 0.31
Nodes (9): DCS-gRPC Mod, Airboss Deck Tracking Implementation Plan, Architecture Overview, Configuration (NSSM), Introduction, Setup and Installation, NSSM (Non-Sucking Service Manager), Rust Backend (+1 more)

### Community 32 - "Spawner Routes Backend"
Cohesion: 0.36
Nodes (8): Display, err_detail(), Json, Response, State, String, spawn_ground(), SpawnGroundPayload

### Community 33 - "Static Asset Embedding"
Cohesion: 0.32
Nodes (6): EmbeddedFile, Assets, Response, serve(), static_handler(), Uri

### Community 34 - "Foothold Config Page"
Cohesion: 0.25
Nodes (6): ConfigResponse, ConfigValue, ConfigValues, MetadataValues, SchemaChoice, SchemaEntry

### Community 35 - "Weather API Routes"
Cohesion: 0.36
Nodes (6): execFilePromise, POST(), GET(), WeatherPresetFile, WeatherState, getMissionName()

### Community 36 - "Project Readme & Docs"
Cohesion: 0.38
Nodes (7): Architecture Overview, Configuration (NSSM), Rust Backend, DCS-gRPC, DCS Web Dashboard, Next.js Frontend, rust-web-dashboard.exe

### Community 37 - "Settings API Routes"
Cohesion: 0.38
Nodes (6): GET(), isRecord(), parseAndSet(), POST(), ServerSettings, SettingValue

### Community 38 - "ORBAT Page UI"
Cohesion: 0.33
Nodes (4): CoalitionData, Group, StaticObj, Unit

### Community 39 - "Weather Page UI"
Cohesion: 0.40
Nodes (4): getTimeOfDayIndicator(), WeatherPage(), WeatherPageData, WeatherPreset

### Community 40 - "Rust Build Script"
Cohesion: 0.40
Nodes (4): Box, main(), Error, Result

### Community 41 - "Events Page UI"
Cohesion: 0.40
Nodes (3): CombatEvent, EventEntity, MissionEvent

### Community 43 - "Red Attacks Map"
Cohesion: 0.40
Nodes (3): FootholdAttack, FootholdZone, TrackedUnit

### Community 44 - "Triggers API Routes"
Cohesion: 0.60
Nodes (4): GET(), POST(), getUserFlag(), setUserFlag()

### Community 50 - "Atmosphere API Route"
Cohesion: 0.83
Nodes (3): GET(), getTemperatureAndPressure(), getWind()

### Community 51 - "Health Check API"
Cohesion: 0.83
Nodes (3): GET(), getHealth(), getVersion()

### Community 52 - "RDP Status API"
Cohesion: 0.83
Nodes (3): commandOutput(), execAsync, GET()

## Knowledge Gaps
- **165 isolated node(s):** `Assets`, `AirbossDataResponse`, `ApiDoc`, `eslintConfig`, `nextConfig` (+160 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **18 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AppState` connect `Backend REST API Layer` to `Spawner Routes Backend`, `Auth & Session Management`, `Axum Server Bootstrap`, `World Routes Backend`, `SRS Backend Routes`, `SSE Broadcast Stream`, `Trigger & Marks Backend`, `Warehouse Routes Backend`?**
  _High betweenness centrality (0.115) - this node is a cross-community bridge._
- **Why does `AuthUser` connect `Backend REST API Layer` to `Spawner Routes Backend`, `Auth & Session Management`, `World Routes Backend`, `SRS Backend Routes`, `Trigger & Marks Backend`, `Warehouse Routes Backend`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **Why does `apiFetch()` connect `Utility Pages UI` to `Airboss Carrier Ops UI`, `Foothold Config Page`, `ORBAT Page UI`, `Weather Page UI`, `SRS Integration Page`, `Players Page UI`, `Settings Page UI`, `Tasks Manager Page`, `Airbase Popup Component`, `Interactive Map Component`, `Unit Popup Component`, `Atmosphere Page UI`, `Foothold Page UI`, `App Layout & Auth Gate`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **What connects `Assets`, `AirbossDataResponse`, `ApiDoc` to the rest of the system?**
  _165 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Backend REST API Layer` be split into smaller, more focused modules?**
  _Cohesion score 0.05142758857929137 - nodes in this community are weakly interconnected._
- **Should `gRPC Proto Definitions` be split into smaller, more focused modules?**
  _Cohesion score 0.06507731958762887 - nodes in this community are weakly interconnected._
- **Should `Airboss Carrier Ops UI` be split into smaller, more focused modules?**
  _Cohesion score 0.05450165612767239 - nodes in this community are weakly interconnected._