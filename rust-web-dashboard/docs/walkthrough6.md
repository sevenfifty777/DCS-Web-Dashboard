# Walkthrough: Map Drawing & Marks

The Radar map is now fully interactive with a new drawing toolbar!

## Changes Made
1. **Backend Integration**: Upgraded `rust-web-dashboard/src/grpc.rs` with `TriggerService` methods for drawing shapes, creating marks, removing marks, and deploying smoke.
2. **REST Endpoints**: Created `routes/trigger.rs` handling endpoints for creating marks/shapes and triggering visual effects.
3. **Frontend Components**: 
   - Built a sleek, floating `<MapToolbar />` to select the current drawing mode.
   - Enhanced the `<Map />` component using Leaflet's `useMapEvents` to capture clicks and dispatch them to the backend API.
4. **Drawing State**: 
   - A list of drawing IDs is preserved locally in the dashboard state.
   - You have a 2-click process for lines and rectangles, giving you precise control over shape dimensions.
   - The toolbar features a red **Clear My Drawings** button that loops through all shapes you've placed and calls `RemoveMark` to clean up the F10 map.

## Functionality
- Go to the **Radar** page.
- Look at the new toolbar in the top-left corner.
- Try selecting **💨 Smoke** and clicking anywhere on the map to spawn red smoke in the live DCS mission.
- Try selecting **📏 Line** or **⬛ Rect**, click once to set the start point, and click again to set the end point.
- Finally, use the **Clear My Drawings** button to delete everything you just drew from the DCS server.

Everything is compiled and ready to go! Try it out on your live map! Should we review what to tackle next from the remaining items in the master plan?
