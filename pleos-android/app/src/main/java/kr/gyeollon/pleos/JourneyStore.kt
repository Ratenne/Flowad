package kr.gyeollon.pleos

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Restored journeys are always paused; no previous SDK state is assumed valid. */
class JourneyStore(context: Context, name: String = "journey") {
    private val preferences = context.getSharedPreferences(name, Context.MODE_PRIVATE)
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val alias = "flowad.journey.aes.v1"
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build())
        }.generateKey()
    }
    fun save(journey: SegmentJourney) {
        val points = JSONArray()
        journey.route.points.forEach { p -> points.put(JSONObject().put("order", p.order).put("type", p.type).put("name", p.name).put("lat", p.latitude).put("lon", p.longitude)) }
        val json = JSONObject().put("version", 2).put("savedAt", System.currentTimeMillis()).put("status", journey.route.status).put("points", points).put("index", if (journey.state == SegmentJourney.State.AWAITING_CONFIRMATION) journey.index + 1 else journey.index)
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
            cipher.updateAAD("flowad.journey.v3".toByteArray(Charsets.UTF_8))
            val encrypted = cipher.doFinal(json.toString().toByteArray(Charsets.UTF_8))
            val envelope = JSONObject().put("version", 3)
                .put("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
                .put("ciphertext", Base64.encodeToString(encrypted, Base64.NO_WRAP))
            preferences.edit().putString("current", envelope.toString()).apply()
        } catch (_: Exception) { clear() } // Never fall back to plaintext if the keystore is unavailable.
    }
    fun clear() { preferences.edit().remove("current").apply() }
    fun load(): SegmentJourney? {
      return try {
        val raw = preferences.getString("current", null) ?: return null
        require(raw.length <= 512_000)
        val envelope = JSONObject(raw)
        require(envelope.getInt("version") == 3) // Discard older plaintext checkpoints.
        val iv = Base64.decode(envelope.getString("iv"), Base64.NO_WRAP)
        require(iv.size == 12)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv)) }
        cipher.updateAAD("flowad.journey.v3".toByteArray(Charsets.UTF_8))
        val json = JSONObject(String(cipher.doFinal(Base64.decode(envelope.getString("ciphertext"), Base64.NO_WRAP)), Charsets.UTF_8))
        require(json.getInt("version") == 2)
        val age = System.currentTimeMillis() - json.getLong("savedAt")
        require(age in 0..86_400_000L)
        val a = json.getJSONArray("points")
        require(a.length() in 2..RouteGuard.MAX_ROUTE_POINTS)
        val points = (0 until a.length()).map { i ->
            val p = a.getJSONObject(i)
            RoutePoint(p.getInt("order"), p.getString("type"), p.getString("name"), p.getDouble("lat"), p.getDouble("lon"))
        }
        SegmentJourney(RecommendedRoute(points, json.getString("status")), json.getInt("index"))
      } catch (_: Exception) { clear(); null }
    }
}
