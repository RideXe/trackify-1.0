// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "trackify_client_sdk",
    platforms: [
        .iOS("15.0")
    ],
    products: [
        .library(name: "trackify-client-sdk", targets: ["trackify_client_sdk"])
    ],
    dependencies: [
        .package(url: "https://github.com/trackify/trackify-client-sdk.git", exact: "0.0.1")
    ],
    targets: [
        .target(
            name: "trackify_client_sdk",
            dependencies: [
                .product(name: "TrackifyClientSDK", package: "trackify-client-sdk")
            ]
        )
    ]
)
