# Walkthrough: Coalition Order of Battle (ORBAT)

The new ORBAT page is successfully implemented!

## Changes Made
1. **Backend gRPC integration**: Added four new gRPC wrappers to `rust-web-dashboard/src/grpc.rs` using DCS-gRPC's `CoalitionService`.
2. **REST API**: Created a new `rust-web-dashboard/src/routes/coalition.rs` file exposing four new endpoints: `/api/coalition/groups`, `/api/coalition/players`, `/api/coalition/statics`, and `/api/coalition/bullseye`. 
3. **Frontend Page**: Built `web-dashboard/src/app/orbat/page.tsx` which fetches both Red and Blue data in parallel, and categorizes it logically into Players, Air, Ground, Naval, and Statics.
4. **Navigation**: Added the ORBAT link to the main sidebar right below "Radar".

## Functionality
- **Manual Refresh**: Click the big "Refresh" button at the top right to pull live data.
- **Collapsible Categories**: Click on any header (e.g., "Air Groups ▼") to expand or collapse that section.
- **Bullseye Reporting**: At the top of each coalition's column, you'll see the exact coordinates for their Bullseye.
- **Player Identification**: Golden text is used for player names so they stand out clearly in the hierarchy.

You can now navigate to `/orbat` on your local dashboard to view the entire breakdown! Let me know if everything looks correct on your end, or if you want to jump right into the next item (Airbase details/parking).
