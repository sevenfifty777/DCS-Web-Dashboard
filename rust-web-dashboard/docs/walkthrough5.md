# Walkthrough: Airbase Details & Parking

The interactive map now features rich popups for all airbases!

## Changes Made
1. **Backend Integration**: Upgraded the local `world.proto` definition so we can access `GetAirbaseParking`, `GetAirbaseRunways`, and `SetAirbaseCoalition` from the gRPC server. I added the new wrappers to `rust-web-dashboard/src/grpc.rs`.
2. **REST Endpoints**: Exposed the gRPC methods via standard HTTP GET/POST routes at `/api/world/airbases/:name/...`.
3. **Frontend Component**: Built `AirbasePopup.tsx`, a specialized React component that mounts whenever you click on an airbase on the `/radar` map.
   - It lazily loads runway dimensions and parking slot availability from the backend when opened to save bandwidth.
   - It includes a dropdown selector to forcefully assign the airbase to a different coalition (Red, Blue, or Neutral) in real-time.

## Functionality
- Go to the **Radar** page.
- Find a blue or red airbase icon and click on it.
- In the popup, you will now see:
  - **Runways**: Their exact headings, length, and width.
  - **Available Parking**: How many spots are currently open for spawning/rearming.
  - **Coalition**: A dropdown allowing you to immediately seize or hand over the airbase to another faction.

Check it out on your local server! Let me know if you are ready to tackle #7 (Map Drawing & Marks), or if you want me to tweak the airbase popups!
