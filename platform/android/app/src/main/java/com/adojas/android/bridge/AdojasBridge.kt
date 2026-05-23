package com.adojas.android.bridge

import android.webkit.JavascriptInterface

/**
 * 注入到 WebView 的 JS 桥接对象。
 *
 * - call():      同步调用，适用于文件读写、设备信息等快速操作
 * - callAsync(): 异步调用（后台线程执行），适用于网络请求等耗时操作
 *                结果通过 __adojas_onResult() 回调到 JS
 *
 * 「API 太少」的问题不在 bridge 层，而在 plugin 层的丰富度。
 * 只需要两个 @JavascriptInterface 方法，所有能力由 Kotlin 插件提供。
 */
class AdojasBridge(
    private val router: IpcRouter,
    private val postResult: ((String) -> Unit)? = null
) {

    /** 同步调用 —— JS 侧阻塞等待 JSON 响应 */
    @JavascriptInterface
    fun call(requestJson: String): String {
        return router.routeJson(requestJson)
    }

    /** 异步调用 —— 后台线程执行，结果通过回调推送到 JS */
    @JavascriptInterface
    fun callAsync(requestJson: String) {
        val respond = postResult ?: return
        Thread {
            val result = router.routeJson(requestJson)
            respond(result)
        }.start()
    }
}
