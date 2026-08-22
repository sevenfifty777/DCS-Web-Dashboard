# DCS Web Dashboard

![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL%203.0-blue.svg)

A powerful, standalone web dashboard and remote administration tool for DCS World Dedicated Servers. Built on a blazing fast Rust backend (`axum` + `tonic`) with a modern Next.js frontend, this dashboard securely connects to your server via DCS-gRPC.

## 🚀 Features

The dashboard provides a massive array of features to help you run your DCS server effortlessly directly from your web browser:

- **Mission Management**: View the mission queue, instantly run new missions, or browse your server's filesystem to load new `.miz` files.
- **Live Radar & ORBAT**: Real-time radar plot of all units (Planes, Helis, Ships, Ground) and a complete hierarchical Order of Battle.
- **Foothold Campaign**: Built-in support for the dynamic Foothold campaign, including a persistent leaderboard, zone capture status, and real-time configuration tuning.
- **Airboss Planner**: A dynamic toolkit for managing carrier operations, automatically syncing Wind Over Deck (WOD) and Base Recovery Course (BRC). Command your carrier to turn into the wind remotely!
- **Weather Injection**: Edit weather settings on-the-fly and seamlessly inject new presets into the active mission using the `DCS-Dynamic-Weather` script.
- **SRS Integration**: Visual configuration editor for `server.cfg`, process management, and live client frequency tracking.
- **Player Management & Chat**: See who is online, read the live chat, send broadcast messages to players, and issue kicks/bans.
- **Server Administration**: Remote access to `serverSettings.lua`, DCS engine crash logs, and background Windows task control for maintenance bots.

## 📚 Documentation

Detailed setup instructions, architecture overview, and full API references are available in our documentation!

**📖 [Read the Documentation](https://sevenfifty777.github.io/DCS-Web-Dashboard/)**

The documentation includes:
- Complete Server Setup Guide
- Configuration Reference
- Interactive Swagger UI (REST API)
- gRPC Protobuf Reference

## 🛠️ Architecture

- **Backend**: Rust (using `axum` for REST/SSE and `tonic` for gRPC) compiled into a single performant binary.
- **Frontend**: Next.js (React) static SPA gracefully embedded into the Rust backend so you don't need a separate web server.
- **DCS Link**: Connects directly to [DCS-gRPC](https://github.com/DCS-gRPC/rust-server) running inside the DCS World engine.

## 📜 License

This project is licensed under the [GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE).
