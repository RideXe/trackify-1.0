import SwiftUI
import TrackifyClientSDK

private let defaultServerUrl = "https://demo.trackify.org/"
private let defaultDeviceId = "123456"

@main
struct SampleApp: App {
    @State private var tracker: Tracker?

    var body: some Scene {
        WindowGroup {
            if let tracker = tracker {
                ContentView(initialTracker: tracker)
            } else {
                ProgressView()
                    .task {
                        let config = Config(serverUrl: defaultServerUrl, deviceId: defaultDeviceId)
                        tracker = try? await TrackerKt.sharedTracker(config: config)
                    }
            }
        }
    }
}

struct ContentView: View {
    let initialTracker: Tracker

    @State private var tracker: Tracker
    @State private var serverUrl: String
    @State private var deviceId: String
    @State private var isTracking = false

    init(initialTracker: Tracker) {
        self.initialTracker = initialTracker
        self._tracker = State(initialValue: initialTracker)
        self._serverUrl = State(initialValue: initialTracker.config.serverUrl)
        self._deviceId = State(initialValue: initialTracker.config.deviceId)
    }

    var body: some View {
        Form {
            Section {
                TextField("Server URL", text: $serverUrl)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                TextField("Device ID", text: $deviceId)
                    .textInputAutocapitalization(.never)
            }
            Section {
                Button("Apply config") {
                    Task {
                        tracker = try await tracker.updateConfig(newConfig: Config(serverUrl: serverUrl, deviceId: deviceId))
                    }
                }
                Button(isTracking ? "Stop" : "Start") {
                    Task {
                        if isTracking {
                            try await tracker.stop()
                            isTracking = false
                        } else {
                            try await tracker.start()
                            isTracking = true
                        }
                    }
                }
            }
        }
    }
}
