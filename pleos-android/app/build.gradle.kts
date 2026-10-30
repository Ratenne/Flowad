plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android { namespace="kr.gyeollon.pleos"; compileSdk=34
 defaultConfig { applicationId="kr.gyeollon.pleos"; minSdk=28; targetSdk=34; versionCode=1; versionName="0.1" }
}
dependencies { implementation("ai.pleos.playground:Vehicle:2.3.1"); implementation("ai.pleos.playground:NaviHelper:3.0.5") }
