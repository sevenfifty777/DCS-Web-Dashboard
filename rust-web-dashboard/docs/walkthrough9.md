# Walkthrough: AI Control Panel

We've successfully added the **AI Control Panel** directly into the Map's Unit Popup! You can now command AI groups right from the map without opening any separate windows.

## Changes Made
1. **Backend gRPC Integrations (`grpc.rs`)**: 
   - Linked up `ControllerService.SetOption` to allow sending Rules of Engagement (ROE) commands.
   - Linked up `ControllerService.SetAlarmState` to allow sending Alarm State commands (useful for SAMs).
   - Linked up `UnitService.GetGroup` so that clicking a unit automatically figures out which group it belongs to before sending the command (so the whole convoy/flight receives the order!).
2. **Backend API Routes (`dcs.rs` & `mod.rs`)**:
   - Exposed `POST /api/units/{name}/roe` (Thanks for the `{name}` tip!).
   - Exposed `POST /api/units/{name}/alarm-state`.
3. **Frontend UI (`UnitPopup.tsx`)**:
   - Split the unit popup into two tabs: **Info** (the original view) and **AI Control**.
   - Added a dropdown for **Rules of Engagement** (Weapon Free, Open Fire, Return Fire, Weapon Hold).
   - Added a dropdown for **Alarm State** (Auto, Green, Red).
   - When you select a dropdown option, it instantly dispatches the command to the DCS server!

## How to Test
1. Compile the backend via `cargo build --release` and upload `rust-web-dashboard.exe`.
2. Compile the frontend via `npm run build` and upload the `out/` contents to `rust-web-dashboard/static/`.
3. Hard refresh your browser (`Ctrl+F5`).
4. On the map, click on any AI unit (like a SAM site or tank).
5. Switch to the new **AI Control** tab.
6. Change the Alarm State to **Green (Radar Off)**. Watch the SAM site shut down its radar!
7. Change the ROE to **Weapon Hold**. The AI will stop engaging targets!
