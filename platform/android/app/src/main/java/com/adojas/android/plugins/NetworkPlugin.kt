package com.adojas.android.plugins

import android.content.Context
import com.adojas.android.bridge.AdojasPlugin
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

/**
 * 网络插件 —— 从原生侧发起 HTTP 请求，完全绕过 WebView 的 CORS 限制。
 *
 * Actions:
 *   - fetch(url, method, headers, body) → { status, headers, body }
 *   - fetchBuffer(url) → Base64 编码的二进制响应体
 *
 * 用法 (JS)：
 * ```ts
 * const resp = await adojasAsync("network", "fetch", {
 *   url: "https://api.xxx.com/levels",
 *   method: "GET"
 * })
 * ```
 */
class NetworkPlugin(private val context: Context) : AdojasPlugin {

    override val name = "network"

    override fun execute(action: String, params: JSONObject): Any? {
        return when (action) {
            "fetch" -> fetch(params)
            "fetchBuffer" -> fetchBuffer(params)
            else -> throw IllegalArgumentException("unknown action: $action")
        }
    }

    private fun fetch(params: JSONObject): Map<String, Any> {
        val urlStr = params.getString("url")
        val method = params.optString("method", "GET").uppercase()
        val headersObj = params.optJSONObject("headers")
        val body = params.optString("body", "")

        val conn = URL(urlStr).openConnection() as HttpURLConnection
        conn.connectTimeout = 15000
        conn.readTimeout = 15000
        conn.requestMethod = method

        // Set headers
        if (headersObj != null) {
            for (key in headersObj.keys()) {
                conn.setRequestProperty(key, headersObj.getString(key))
            }
        }

        // Write body (POST/PUT)
        if ((method == "POST" || method == "PUT") && body.isNotEmpty()) {
            conn.doOutput = true
            OutputStreamWriter(conn.outputStream, "UTF-8").use { it.write(body) }
        }

        val responseCode = conn.responseCode
        val responseBody = try {
            conn.inputStream.bufferedReader().readText()
        } catch (_: Exception) {
            conn.errorStream?.bufferedReader()?.readText() ?: ""
        }

        // Collect response headers
        val responseHeaders = mutableMapOf<String, String>()
        for (i in 0 until conn.headerFields.size) {
            conn.headerFields.keys?.elementAtOrNull(i)?.let { key ->
                conn.getHeaderField(key)?.let { value ->
                    responseHeaders[key] = value
                }
            }
        }

        conn.disconnect()

        return mapOf(
            "status" to responseCode,
            "body" to responseBody,
            "headers" to responseHeaders
        )
    }

    private fun fetchBuffer(params: JSONObject): String {
        val urlStr = params.getString("url")
        val conn = URL(urlStr).openConnection() as HttpURLConnection
        conn.connectTimeout = 15000
        conn.readTimeout = 15000
        conn.requestMethod = "GET"

        val bytes = conn.inputStream.readBytes()
        conn.disconnect()

        return android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
    }
}
