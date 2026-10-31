plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android { useLibrary("android.car"); buildFeatures { buildConfig = true }; namespace="kr.gyeollon.pleos"; compileSdk=34
 compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
 kotlinOptions { jvmTarget = "17" }
 defaultConfig { testInstrumentationRunner="androidx.test.runner.AndroidJUnitRunner"; applicationId="kr.gyeollon.pleos"; minSdk=28; targetSdk=34; versionCode=1; versionName="0.1" }
}
dependencies { implementation("ai.pleos.playground:Vehicle:2.3.2"); implementation("androidx.webkit:webkit:1.12.1"); implementation("ai.pleos.playground:NaviHelper:3.0.5"); testImplementation("junit:junit:4.13.2"); androidTestImplementation("androidx.test:core:1.6.1"); androidTestImplementation("androidx.test:runner:1.6.2"); androidTestImplementation("androidx.test:rules:1.6.1") }
