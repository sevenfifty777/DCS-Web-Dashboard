# Walkthrough: Live Server Performance Monitor

We've successfully added a new real-time performance widget directly into the dashboard sidebar! This allows you to monitor the health of your DCS server at a glance, from anywhere in the application.

## Changes Made
1. **Backend gRPC Integrations**: 
   - Added wrappers for `get_ballistics_count`, `get_model_time`, and `get_real_time` in `grpc.rs` using `HookService`.
   - Exposed a new `GET /api/performance` endpoint in the backend that fetches all three metrics concurrently and calculates the server's time ratio.
2. **Frontend Widget (`ServerPerformance.tsx`)**:
   - Built a sleek, color-coded widget that sits at the bottom of the left-hand navigation sidebar.
   - It hooks into the existing Server-Sent Events (`/api/events/stream`) to instantly display the latest **Simulation FPS** without needing to poll.
   - It polls the new `/api/performance` endpoint every 3 seconds to update the **Time Ratio** and **Active Ballistics**.
3. **Color Coding for Quick Health Checks**:
   - **Green**: Server is healthy (FPS > 30, Time Ratio ~ 1.0)
   - **Yellow**: Server is under load (FPS > 15, Time Ratio > 0.75)
   - **Red**: Server is heavily lagging

## How to Test
1. Compile the backend via `cargo build --release` and upload `rust-web-dashboard.exe`.
2. Compile the frontend via `npm run build` and upload the `out/` contents to `rust-web-dashboard/static/`.
3. Hard refresh your browser (`Ctrl+F5`).
4. Look at the bottom left of the Sidebar. You should see the new "LIVE PERFORMANCE" widget!
5. In DCS, try firing a lot of weapons or dropping cluster bombs to see the active ballistics spike and watch how it affects the Server FPS and Time Ratio!
