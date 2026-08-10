# Walkthrough: Priority 2 - Interactive Map & Unit Tracking

I have completed the frontend upgrades to the radar map per your request!

## Changes Made
1. **Live Combat Events Overlay**
   - Added a "Live Combat Events" checkbox at the top-right of the Map to toggle the event overlay on and off.
   - The map now listens to `/api/events/stream` and parses incoming gRPC `StreamEventsResponse` frames.
   - Missile launches (`shot`) trigger a pulsing crosshair animation.
   - Explosions (`hit`, `kill`, `dead`) trigger a larger, pulsing blast-radius icon.
   - These temporary event markers automatically disappear after 8 seconds so your map doesn't get overly cluttered.
   - Added `@keyframes pulse` in `globals.css` to drive the pulsing animations.

2. **Player Identification**
   - Added a new hover `Tooltip` directly onto any map marker that represents a human player. Now, simply hovering over a golden-bordered player icon will show you their name without needing to click the marker to open the popup!
   - (Remember, the player names inside the popup itself were already resolved by our earlier SRS fixes which ensured `player_name` was correctly streaming to the frontend).

## Validation Results
- Verified that `Map.tsx` correctly handles and filters the SSE events.
- Successfully built the `web-dashboard` Next.js application.

You should now see the checkbox on the `/radar` page and player names popping up immediately on hover! Let me know if you want to tweak the 8-second expiry timer or the animation styles at all!
