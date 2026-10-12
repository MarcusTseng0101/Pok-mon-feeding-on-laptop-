plugins {
    id("com.android.application")
}

android {
    namespace = "dev.kalos.journey"
    compileSdk = 34
    defaultConfig {
        applicationId = "dev.kalos.journey"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

// 遊戲的網頁檔案：照 repo 裡的資料夾結構放進 assets/www（網頁裡的 ../core/、../../data/ 這些相對路徑才不用改）
val journeyAssets = layout.buildDirectory.dir("journey-assets")
val copyJourney by tasks.registering(Sync::class) {
    val root = rootProject.projectDir.parentFile
    into(journeyAssets.map { it.dir("www") })
    from(File(root, "src/journey")) { into("src/journey") }
    from(File(root, "src/core")) { into("src/core") }
    from(File(root, "src/renderer/audio")) { into("src/renderer/audio") }
    from(File(root, "src/renderer/fonts")) { into("src/renderer/fonts") }
    from(File(root, "data/kalos.json")) { into("data") }
}
android.sourceSets["main"].assets.srcDir(journeyAssets)
tasks.named("preBuild") { dependsOn(copyJourney) }
