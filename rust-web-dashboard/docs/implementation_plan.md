# DCS-Web-Dashboard gRPC API Enhancement Plan

This plan outlines new features and improvements to the DCS-Web-Dashboard, leveraging the recently updated DCS-gRPC server (sevenfifty777/rust-server) capabilities.

## User Review Required

> [!IMPORTANT]
> Please review the proposed new features below. They introduce significant admin capabilities (such as Kick/Ban, Spawning/Destroying units, and Server-wide announcements). Let me know which features you would like prioritized for the first phase of implementation.

## Open Questions

> [!TIP]
> 1. **Radar/Map Integration**: Do you want the ability to spawn AI groups (e.g., tankers, drones) via the web dashboard map, or just the ability to view/destroy them?
> 2. **Admin Messages**: Should server-wide announcements (`OutText`) be added to the Chat tab, or deserve their own "Announcements" widget?
> 3. **Warehouse Management**: Is viewing and modifying airbase inventory (ammo/fuel) a priority for your use case?

## Proposed Changes

We will introduce several backend routes (`rust-web-dashboard/src/routes/...`) mapping to the new gRPC endpoints, and create their corresponding UI components in the Next.js `web-dashboard`.

---

### 1. Advanced Player Management (Kick & Ban)
Currently, the `/players` page only lists players. We will add the ability to manage bad actors.

#### [MODIFY] `rust-web-dashboard/src/grpc.rs`
- Expose `NetService.KickPlayer` and `HookService.BanPlayer` / `UnbanPlayer`.

#### [MODIFY] `rust-web-dashboard/src/routes/dcs.rs`
- Add `POST /api/players/kick` and `POST /api/players/ban` endpoints.

#### [MODIFY] `web-dashboard/src/app/players/page.tsx`
- Add UI buttons in the player table for "Kick" and "Ban", triggering the new APIs.

---

### 2. Admin Announcements (Screen Text)
Currently, the dashboard only sends chat messages. We can use the new Trigger API to flash text directly in the center of players' screens.

#### [MODIFY] `rust-web-dashboard/src/grpc.rs`
- Expose `TriggerService.OutText` and `TriggerService.OutTextForCoalition`.

#### [MODIFY] `rust-web-dashboard/src/routes/dcs.rs`
- Add `POST /api/announcements` endpoint.

#### [MODIFY] `web-dashboard/src/app/chat/page.tsx` (or new Announcements component)
- Add a toggle to send messages as "Chat" or "Screen Text (OutText)".

---

### 3. Interactive Map & Unit Details (Radar)
The radar currently just streams blips. We can fetch deep telemetry for clicked units and allow admin intervention.

#### [MODIFY] `rust-web-dashboard/src/grpc.rs`
- Expose `UnitService.GetFuel`, `GetAmmo`, `GetLife` for detailed unit inspection.
- Expose `GroupService.Destroy` for admin "smite" capabilities.

#### [MODIFY] `rust-web-dashboard/src/routes/stream.rs` & `dcs.rs`
- Add a `GET /api/units/:id/details` endpoint fetching Fuel/Ammo.
- Add a `POST /api/groups/:id/destroy` endpoint.

#### [MODIFY] `web-dashboard/src/app/radar/page.tsx`
- Implement a click-handler on map units to open a side-panel displaying live Fuel/Ammo/Health, and a red "Destroy" button for admins.

---

### 4. Mission Environment & Time
Improve the dashboard header and weather page with new environment data.

#### [MODIFY] `rust-web-dashboard/src/grpc.rs`
- Expose `TimerService.GetTime` and `WorldService.GetTheatre`.
- Update `AtmosphereService` wrapper to include `GetWindWithTurbulence`.

#### [MODIFY] `rust-web-dashboard/src/routes/dcs.rs`
- Include Theatre and Mission Time in the `/api/mission` status response.
- Update `/api/atmosphere` to fetch turbulence.

#### [MODIFY] `web-dashboard/src/app/layout.tsx` / `mission/page.tsx`
- Display the Theatre (e.g. Caucasus, Syria) and live In-Game Time in the dashboard header.

---

## Verification Plan

### Automated Tests
- Validate that the Rust backend compiles successfully (`cargo check` / `cargo build`).
- Ensure the Next.js frontend builds without type errors (`npm run build`).

### Manual Verification
1. **Player Kick/Ban**: Join the server, execute a kick via the dashboard, and verify the client disconnects.
2. **Announcements**: Send a message via the dashboard as "Screen Text" and verify it appears in the center of the DCS screen.
3. **Radar Interaction**: Open the web radar, click an active unit, and confirm its fuel and ammo states load correctly. Attempt to destroy the unit.
4. **Environment Info**: Verify the theatre map name and in-game time accurately reflect the running `.miz` file.
