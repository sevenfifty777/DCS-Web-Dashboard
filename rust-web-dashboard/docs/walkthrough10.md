# Walkthrough: JTAC & Laser Management

The JTAC module is online! You can now command your ground units, infantry, or drones to start painting targets on the map with lasers and IR pointers. 

## Changes Made
1. **Backend Integration (`grpc.rs` & `dcs.rs`)**:
   - Integrated the DCS gRPC `SpotService`.
   - Added `create_laser` and `create_ir_pointer`.
   - Exposed API endpoints:
     - `POST /api/units/{name}/lase`
     - `POST /api/units/{name}/ir-point`
     - `DELETE /api/spots/{id}`
   - The backend automatically calculates the 3D direction vector from the source unit to the map click coordinates!

2. **Frontend UI (`UnitPopup.tsx` & `Map.tsx`)**:
   - Added a **JTAC** tab to the Unit Popup.
   - You can enter a **Laser Code** (default: 1688).
   - Clicking **Lase Target on Map** or **Point IR on Map** switches the map into "targeting mode".
   - Clicking anywhere on the map calculates the coordinates, dispatches the command, and draws a dashed line on the map connecting the source unit to the target!
   - You can click the dashed line on the map to open a popup and turn the laser/IR pointer off.

## How to Test
1. Recompile the backend with `cargo build --release` and copy over `rust-web-dashboard.exe`.
2. Build the frontend with `npm run build` and update the `static/` folder.
3. Open DCS, jump into an A-10C, F/A-18C, or AH-64D.
4. Spawn an AI ground unit or drone (like a Reaper).
5. On the dashboard, click the drone, switch to the **JTAC** tab, set a code, and click "Lase Target on Map".
6. Click anywhere near your aircraft on the map.
7. Verify that you see a dashed line on the dashboard map, and verify that your targeting pod in DCS picks up the laser!
