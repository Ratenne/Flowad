package kr.gyeollon.pleos

import android.car.Car
import android.car.drivingstate.CarUxRestrictionsManager
import android.content.Context

/** Unknown, disconnected, and errors all deny UI actions. */
class ParkedRestriction(context: Context, private val changed: (Boolean) -> Unit) {
    private var car: Car? = null
    private var manager: CarUxRestrictionsManager? = null
    @Volatile private var allowed = false
    init {
        try {
            car = Car.createCar(context)
            manager = car?.getCarManager(Car.CAR_UX_RESTRICTION_SERVICE) as? CarUxRestrictionsManager
            val restrictions = manager
            if (restrictions != null) {
                restrictions.registerListener { value ->
                    allowed = !value.isRequiresDistractionOptimization
                    changed(allowed)
                }
                allowed = !restrictions.currentCarUxRestrictions.isRequiresDistractionOptimization
            }
        } catch (_: Exception) { allowed = false }
        changed(allowed)
    }
    fun canInteract(): Boolean = try {
        val c = car
        val m = manager
        allowed && c != null && c.isConnected && m != null && !m.currentCarUxRestrictions.isRequiresDistractionOptimization
    } catch (_: Exception) { false }
    fun close() {
        allowed = false
        try { manager?.unregisterListener() } catch (_: Exception) { }
        try { car?.disconnect() } catch (_: Exception) { }
        manager = null
        car = null
    }
}
