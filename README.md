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

## License
Trackify is based on the open-source Traccar project. Licensed under the Apache License, Version 2.0.
