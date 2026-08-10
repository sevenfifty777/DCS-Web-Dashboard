# Walkthrough: Coalition Spawner

The Coalition Spawner is now complete! You can dynamically spawn entire ground groups directly from the map with just a few clicks.

## Changes Made
1. **Backend Integration (`grpc.rs` & `spawner.rs`)**:
   - Wired up the `CoalitionService.AddGroup` gRPC call to bypass Lua completely.
   - Built the `POST /api/spawn/ground` endpoint that handles creating the `GroundGroupTemplate` payload.
   - Implemented support for **multi-unit groups**: You can specify a `count` between 1 and 10, and the backend automatically spaces the units out slightly so they don't spawn inside one another.

2. **Frontend UI (`MapToolbar.tsx` & `Map.tsx`)**:
   - Added a new 🚜 **Spawn** tool to the Map Toolbar.
   - Created an intuitive **Spawn Ground Group** panel that pops up.
   - From the panel, you can choose the Coalition, Unit Type (Armor, SAMs, Support trucks), Group Name, and Unit Count.
   - Clicking on the map instantly fires off the coordinates to the API and spawns the group!

## How to Test
1. Recompile the backend with `cargo build --release` and copy over `rust-web-dashboard.exe`.
2. Build the frontend with `npm run build` and update the `static/` folder.
3. Open the Dashboard.
4. Click the **🚜 Spawn** tool on the left side of the map.
5. In the new Spawner panel, set the Coalition to Russia (Red), select `SA-15 Tor`, and set the Unit Count to `3`.
6. Click an empty location on the map.
7. Jump into DCS and watch the SAM battery materialize!
