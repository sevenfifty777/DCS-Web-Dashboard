# Walkthrough: Unit Deep Inspector

The "Deep Inspect" feature on the Radar Map's Unit Popup is now fully upgraded to use DCS-gRPC's native `UnitService`.

## Changes Made
1. **Backend Optimizations**: 
   - Replaced the slow, injected Lua `Eval` call with 5 parallel gRPC unary calls (`get_life`, `get_fuel`, `get_ammo`, `get_radar`, `get_sensors`) utilizing `tokio::join!`. This significantly improves the responsiveness of the popups.
2. **Radar & Sensor Integrations**:
   - The popup now displays the raw optical/radar sensor data from the platform. It shows the detection ranges for Radar and IRST systems.
   - It shows whether the unit's radar is currently emitting (ON) or silenced (OFF).
   - Added a new `POST /api/units/:name/emission` endpoint mapped to `UnitService.SetEmission`.
   - The popup includes a "Toggle Emission" button which allows you to remotely command a SAM site, ship, or aircraft to turn its radar on or off on the fly!

## Testing the changes
- Open up the **Radar Map**.
- Click on any unit with sensors (e.g., an AWACS, a SAM site, or a modern jet).
- Click the **Deep Inspect** button in the popup.
- Note how fast the Fuel, Health, and Ammo fetch compared to before.
- Look at the new **Sensors** and **Radar** readout. 
- Try clicking the **Toggle Emission** button and watch the DCS unit respond immediately!

You will just need to copy the `web-dashboard/out/` directory to the `static` folder and `cargo build` like last time to test the release binary yourself. Should we continue to the next priority item in the master plan (Priority 4: Live Data Feeds & Logs)?
