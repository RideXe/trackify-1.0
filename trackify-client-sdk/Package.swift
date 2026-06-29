// swift-tools-version:5.5
import PackageDescription

let package = Package(
    name: "TrackifyClientSDK",
    platforms: [
        .iOS(.v15),
    ],
    products: [
        .library(name: "TrackifyClientSDK", targets: ["TrackifyClientSDK", "TrackifyClientAutoInit"]),
    ],
    targets: [
        .binaryTarget(
            name: "TrackifyClientSDK",
            path: "core/build/XCFrameworks/release/TrackifyClientSDK.xcframework"
        ),
        .target(
            name: "TrackifyClientAutoInit",
            dependencies: ["TrackifyClientSDK"],
            path: "core/Sources/TrackifyClientAutoInit",
            publicHeadersPath: "include"
        ),
    ]
)
