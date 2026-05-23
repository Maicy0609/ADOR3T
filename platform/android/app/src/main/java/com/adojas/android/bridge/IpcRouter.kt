package com.adojas.android.bridge

import org.json.JSONObject

/**
 * IPC 路由器 —— 将 JS 侧的调用请求分发给注册的插件。
 *
 * 调用格式（JSON）：
 * ```json
 * { "id": "req_001", "plugin": "file", "action": "read", "params": { "path": "..." } }
 * ```
 *
 * 响应格式（JSON）：
 * ```json
 * { "id": "req_001", "success": true, "data": ... }
 * { "id": "req_001", "success": false, "error": "message" }
 * ```
 */
class IpcRouter {

    private val plugins = mutableMapOf<String, AdojasPlugin>()

    /** 注册一个插件 */
    fun register(plugin: AdojasPlugin) {
        plugins[plugin.name] = plugin
    }

    /**
     * 路由一个 JSON 调用，返回 JSON 响应。
     * 由 @JavascriptInterface 在 WebView 的 UI 线程调用。
     */
    fun routeJson(requestJson: String): String {
        return try {
            val req = JSONObject(requestJson)
            val pluginName = req.optString("plugin")
            val action = req.optString("action")
            val params = req.optJSONObject("params") ?: JSONObject()
            val id = req.optString("id", "")

            val plugin = plugins[pluginName]
                ?: return errorResponse(id, "plugin not found: $pluginName")

            val result = plugin.execute(action, params)
            successResponse(id, result)
        } catch (e: Exception) {
            errorResponse("", e.message ?: "unknown error")
        }
    }

    private fun successResponse(id: String, data: Any?): String {
        val resp = JSONObject()
        resp.put("id", id)
        resp.put("success", true)
        resp.put("data", data)
        return resp.toString()
    }

    private fun errorResponse(id: String, error: String): String {
        val resp = JSONObject()
        resp.put("id", id)
        resp.put("success", false)
        resp.put("error", error)
        return resp.toString()
    }
}
