package kr.gyeollon.pleos

import android.content.Context
import ai.pleos.playground.vehicle.Vehicle
import ai.pleos.playground.vehicle.api.model.capability.AccessType

/** Field names match TeslaIntegration.Reading. Missing data remains null. */
data class VehicleReading(val status: String, val batteryPercent: Int?, val estimatedRangeKm: Double?, val observedAt: Long?, val stale: Boolean, val latitude: Double?, val longitude: Double?, val locationStatus: String)
class PleosVehicleAdapter(context: Context) {
    private val vehicle = Vehicle(context.applicationContext)
    @Volatile private var closed = false
    init { vehicle.initialize() }
    fun battery(callback: (Int?) -> Unit) {
        try {
            val battery = vehicle.getEvBattery()
            battery.checkEvBatteryStateOfChargeCapabilities(onComplete = { capability ->
                if (!closed && capability.accessType in listOf(AccessType.READ, AccessType.READ_WRITE)) {
                    battery.getEvBatteryStateOfCharge(onComplete = { value -> if (!closed) callback(value?.takeIf { it in 0..100 }) }, onFailed = { if (!closed) callback(null) })
                } else if (!closed) callback(null)
            }, onFailed = { if (!closed) callback(null) })
        } catch (_: Exception) { if (!closed) callback(null) }
    }
    fun close() { closed = true; vehicle.release() }
}
