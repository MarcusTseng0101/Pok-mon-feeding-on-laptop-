// 卡洛斯旅行的 Android 外殼（WebView）。遊戲本體是 src/journey＋src/core，建置時複製進 APK 的 assets。
// 不用 AndroidX、不用 Kotlin：只有 Android Gradle Plugin
pluginManagement {
    repositories { google(); mavenCentral(); gradlePluginPortal() }
}
dependencyResolutionManagement {
    repositories { google(); mavenCentral() }
}
rootProject.name = "kalos-journey"
include(":app")
