# Trackify

Trackify is an open-source, full-stack GPS tracking system. It enables real-time location tracking of mobile devices and fleets with a powerful backend and an intuitive modern web dashboard.

## Ecosystem Overview

The Trackify ecosystem is divided into the following sub-projects:

1. **[Backend Server (`trackify/`)](./trackify/)**
   - A high-performance Java-based backend service.
   - Handles GPS protocol parsing, data storage, and serves the REST API.
   - Powered by an H2 database by default, with support for all major SQL databases.

2. **[Web Dashboard (`trackify-web/`)](./trackify-web/)**
   - A modern React & Vite frontend application.
   - Provides a map interface to track devices in real-time, view reports, manage geofences, and send commands.

3. **[Mobile Client App (`trackify-client/`)](./trackify-client/)**
   - A Flutter-based GPS tracking app for Android and iOS.
   - Runs in the background and periodically sends location updates to your Trackify server.

4. **[Mobile Client SDK (`trackify-client-sdk/`)](./trackify-client-sdk/)**
   - The core tracking engine SDK used by the client app.

## Quick Start (Local Development)

### 1. Start the Backend Server
```bash
cd trackify
./gradlew assemble
java -jar target/tracker-server.jar setup/trackify.xml
```

### 2. Start the Web Dashboard
Open a new terminal:
```bash
cd trackify-web
npm install
npm start
```
The dashboard will be available at [http://localhost:3000](http://localhost:3000).

### 3. Start the Mobile Client
Open a third terminal:
```bash
cd trackify-client
flutter pub get
flutter run
```
*Make sure to configure the "Server URL" in the app settings to point to your laptop's Wi-Fi IP Address (e.g., `http://192.168.x.x:5055`).*

## Run with Docker + AWS RDS (MySQL)

The Docker image bundles the server and the web dashboard. The database settings are **not** stored in the repo — provide them as environment variables, or in a `.env` file next to `docker-compose.yml` (it is git-ignored):

| Variable | Required | Example |
|---|---|---|
| `RDS_ENDPOINT` | yes | `trackify.abc123xyz.ap-south-1.rds.amazonaws.com` |
| `RDS_DATABASE` | no (default `trackify`) | `trackify` |
| `DATABASE_USER` | yes | `admin` |
| `DATABASE_PASSWORD` | yes | *(your RDS password)* |

```bash
docker compose up -d --build
docker compose ps        # wait for "healthy" (first start runs database migrations)
```

- **Use the RDS endpoint hostname**, not an IP address. The connection uses `sslMode=VERIFY_IDENTITY`, which verifies the RDS certificate and hostname; the image trusts the Amazon RDS root certificates.
- **Create the `trackify` database** in RDS before the first start.
- **Ports:** `8082` web + API · `5023` GT06/Concox (TCP) · `5027` Teltonika (TCP + UDP) · `5055` phone app. To support more tracker types, add them to `protocols.enable` in [`trackify/setup/trackify.xml`](./trackify/setup/trackify.xml) and publish their ports in `docker-compose.yml`.
- The container runs as a non-root `trackify` user; data, logs, and device media are kept in Docker volumes.

## License
Trackify is based on the open-source Traccar project. Licensed under the Apache License, Version 2.0.
