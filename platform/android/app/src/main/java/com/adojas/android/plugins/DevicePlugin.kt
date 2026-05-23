package com.adojas.android.plugins

import android.content.Context
import android.os.Build
import android.view.WindowManager
import com.adojas.android.bridge.AdojasPlugin
import org.json.JSONObject

/**
 * 设备信息插件 —— 提供设备硬件、系统、屏幕信息。
 *
 * Actions:
 *   - info()        → 设备基本信息 (型号, API 级别, 可用内存等)
 *   - screenSize()  → 屏幕宽高像素
 *   - vibrate(duration) → 震动
 */
class DevicePlugin(private val context: Context) : AdojasPlugin {

    override val name = "device"

    override fun execute(action: String, params: JSONObject): Any? {
        return when (action) {
            "info" -> deviceInfo()
            "screenSize" -> screenSize()
            "vibrate" -> vibrate(params)
            else -> throw IllegalArgumentException("unknown action: $action")
        }
    }

    private fun deviceInfo(): Map<String, Any> {
        val memInfo = android.app.ActivityManager.MemoryInfo()
        val am = context.getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager
        am.getMemoryInfo(memInfo)

        return mapOf(
            "model" to Build.MODEL,
            "manufacturer" to Build.MANUFACTURER,
            "sdkInt" to Build.VERSION.SDK_INT,
            "release" to Build.VERSION.RELEASE,
            "totalMemory" to memInfo.totalMem,
            "availableMemory" to memInfo.availMem
        )
    }

    private fun screenSize(): Map<String, Int> {
        val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val metrics = android.util.DisplayMetrics()
        wm.defaultDisplay.getRealMetrics(metrics)
        return mapOf("width" to metrics.widthPixels, "height" to metrics.heightPixels)
    }

    private fun vibrate(params: JSONObject): Boolean {
        val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as android.os.Vibrator
        val duration = params.optLong("duration", 50L)
        vibrator.vibrate(duration)
        return true
    }
}
