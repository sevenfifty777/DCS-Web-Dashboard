# DCS-Web-Dashboard Documentation

A standalone web dashboard and remote administration tool for DCS World dedicated servers. It is a
single Windows executable: a Rust backend with the web interface built into it, connecting to your
server through [DCS-gRPC](https://github.com/sevenfifty777/rust-server). There is no Node.js
runtime to install and no separate web server to run.

## New here? Start with these, in order

1. **[Setup & Installation](./setup.md)** — download or build the dashboard and get it onto your
   server.
2. **[Configuration (NSSM)](./configuration.md)** — run it as a Windows service and set every
   environment variable, with examples.
3. **[DCS & SRS Process Control Setup](./process_control_setup.md)** — make the Start, Stop and
   Restart buttons work, and optionally run the server unattended.
4. **[Features & Admin Manual](./features.md)** — a tour of every page in the dashboard.

## Reference

- **[Architecture](./architecture.md)** — how the pieces fit together.
- **[Publishing a Release](./releasing.md)** — cutting and publishing a new version.
- **[REST API](./rest-api.md)** — interactive Swagger UI for the dashboard's own API.
- **[gRPC API](./api_grpc.md)** — the DCS-gRPC service definitions the dashboard consumes.

The design documents at the end of the sidebar record how individual features were planned and
built. They are written for contributors and are not needed to run the dashboard.

## Getting help

Report a problem or ask a question on the
[issue tracker](https://github.com/sevenfifty777/DCS-Web-Dashboard/issues). The dashboard's own
logs are the best starting point: with the NSSM setup below they are written to `logs\dashboard.log`
and `logs\dashboard-error.log` beside the executable.
