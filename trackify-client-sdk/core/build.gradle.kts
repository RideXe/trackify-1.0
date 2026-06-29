import com.vanniktech.maven.publish.SonatypeHost
import org.jetbrains.kotlin.gradle.plugin.mpp.apple.XCFramework

plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.androidKotlinMultiplatformLibrary)
    alias(libs.plugins.sqldelight)
    alias(libs.plugins.kotlinSerialization)
    alias(libs.plugins.vanniktechMavenPublish)
}

group = "org.trackify"
version = System.getenv("RELEASE_VERSION") ?: "0.0.2"

sqldelight {
    databases {
        create("Database") {
            packageName.set("org.trackify.client.db")
        }
    }
}

kotlin {
    android {
        namespace = "org.trackify.client"
        compileSdk = libs.versions.android.compileSdk.get().toInt()
        minSdk = libs.versions.android.minSdk.get().toInt()
        androidResources.enable = true
    }

    val xcframework = XCFramework("TrackifyClientSDK")

    listOf(
        iosX64(),
        iosArm64(),
        iosSimulatorArm64(),
    ).forEach { iosTarget ->
        iosTarget.binaries.framework {
            baseName = "TrackifyClientSDK"
            isStatic = true
            xcframework.add(this)
        }
    }

    sourceSets {
        commonMain.dependencies {
            implementation(libs.kotlinx.coroutines.core)
            implementation(libs.kotlinx.serialization.json)
            implementation(libs.ktor.client.core)
            implementation(libs.sqldelight.runtime)
            implementation(libs.koin.core)
        }
        androidMain.dependencies {
            implementation(libs.ktor.client.android)
            implementation(libs.androidx.activity)
            implementation(libs.sqldelight.android.driver)
            implementation(libs.play.services.location)
        }
        iosMain.dependencies {
            implementation(libs.ktor.client.darwin)
            implementation(libs.sqldelight.native.driver)
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
        }
    }
}

mavenPublishing {
    publishToMavenCentral(SonatypeHost.CENTRAL_PORTAL, automaticRelease = true)
    // signAllPublications()
    coordinates("org.trackify", "trackify-client-sdk", version.toString())
    pom {
        name.set("Trackify Client SDK")
        description.set("Kotlin Multiplatform location tracking SDK for Trackify.")
        url.set("https://github.com/trackify/trackify-client-sdk")
        licenses {
            license {
                name.set("The Apache License, Version 2.0")
                url.set("https://www.apache.org/licenses/LICENSE-2.0.txt")
            }
        }
        developers {
            developer {
                id.set("tananaev")
                name.set("Anton Tananaev")
                email.set("anton@trackify.org")
            }
        }
        scm {
            url.set("https://github.com/trackify/trackify-client-sdk")
            connection.set("scm:git:https://github.com/trackify/trackify-client-sdk.git")
            developerConnection.set("scm:git:ssh://git@github.com/trackify/trackify-client-sdk.git")
        }
    }
}
