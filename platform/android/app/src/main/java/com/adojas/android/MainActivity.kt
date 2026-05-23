package com.adojas.android

import android.annotation.SuppressLint
import android.content.Context
import android.os.Bundle
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.appcompat.app.AppCompatActivity
import com.adojas.android.bridge.AdojasBridge
import com.adojas.android.bridge.IpcRouter
import com.adojas.android.plugins.AudioPlugin
import com.adojas.android.plugins.DevicePlugin
import com.adojas.android.plugins.FilePlugin
import com.adojas.android.plugins.NetworkPlugin
import com.google.android.material.button.MaterialButton

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private val router = IpcRouter()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // 注册插件
        router.register(FilePlugin(this))
        router.register(DevicePlugin(this))
        router.register(AudioPlugin(this))
        router.register(NetworkPlugin(this))

        // 首次启动检测
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val isFirstLaunch = prefs.getBoolean(PREF_FIRST_LAUNCH, true)

        if (isFirstLaunch) {
            showWelcome()
        } else {
            initWebView()
            loadWebApp()
        }
    }

    // ========================================================================
    // 欢迎页 (Material Design 3)
    // ========================================================================

    private fun showWelcome() {
        findViewById<MaterialButton>(R.id.btn_start).setOnClickListener {
            getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putBoolean(PREF_FIRST_LAUNCH, false)
                .apply()

            initWebView()
            loadWebApp()

            // 切换可见性
            findViewById<View>(R.id.welcome_container).visibility = View.GONE
            findViewById<FrameLayout>(R.id.webview_container).visibility = View.VISIBLE
        }
    }

    // ========================================================================
    // WebView 初始化
    // ========================================================================

    @SuppressLint("SetJavaScriptEnabled")
    private fun initWebView() {
        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = true
            settings.allowContentAccess = true
            settings.setSupportMultipleWindows(false)

            // 允许 file:// 跨域访问（外部资源通过 NetworkPlugin 走原生，绕开 CORS）
            settings.allowFileAccessFromFileURLs = true
            settings.allowUniversalAccessFromFileURLs = true

            // 硬件加速
            setLayerType(WebView.LAYER_TYPE_HARDWARE, null)

            // JS 桥接 —— call() 同步；callAsync() 异步结果通过 evaluateJavascript 推回
            addJavascriptInterface(
                AdojasBridge(router) { resultJson ->
                    runOnUiThread {
                        evaluateJavascript(
                            "window.__adojas_onResult($resultJson)",
                            null
                        )
                    }
                },
                "AdojasBridge"
            )

            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                }
            }

            webChromeClient = WebChromeClient()
        }

        findViewById<FrameLayout>(R.id.webview_container).addView(
            webView,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )
    }

    private fun loadWebApp() {
        webView.loadUrl("file:///android_asset/web/index.html")
    }

    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    companion object {
        private const val PREFS_NAME = "adojas_prefs"
        private const val PREF_FIRST_LAUNCH = "first_launch"
    }
}
