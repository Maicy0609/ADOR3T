package com.adojas.android

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
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

    // File chooser callback (WebView <input type="file">)
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val data = result.data
        if (result.resultCode == RESULT_OK && data != null) {
            val uris = if (data.clipData != null) {
                (0 until data.clipData!!.itemCount).map { data.clipData!!.getItemAt(it).uri }.toTypedArray()
            } else {
                data.data?.let { arrayOf(it) } ?: emptyArray()
            }

            fileChooserCallback?.onReceiveValue(uris)

            // 解析选中文件的真实路径，注入到 JS 供 fs.ts 自动加载关联资源
            if (uris.isNotEmpty() && ::webView.isInitialized) {
                val realPath = resolveContentUri(uris[0])
                if (realPath != null) {
                    val dir = realPath.substringBeforeLast('/')
                    val escaped = dir.replace("'", "\\'")
                    webView.evaluateJavascript(
                        "window.__adojas_fileDir = '$escaped';" +
                        "window.__adojas_fileName = '${realPath.substringAfterLast('/').replace("'", "\\'")}';",
                        null
                    )
                }
            }
        } else {
            fileChooserCallback?.onReceiveValue(null)
        }
        fileChooserCallback = null
    }

    // ========================================================================
    // 从 content:// URI 解析真实文件路径
    // ========================================================================

    private fun resolveContentUri(uri: Uri): String? {
        // 1. file:// → 直接返回
        if (uri.scheme == "file") return uri.path

        // 2. content:// → 尝试从 ContentResolver 查询
        if (uri.scheme == "content") {
            // DocumentProvider (如系统文件选择器)
            val docId = try {
                android.provider.DocumentsContract.isDocumentUri(this, uri)
            } catch (_: Exception) { false }

            if (docId) {
                return try {
                    android.provider.DocumentsContract.getDocumentThumbnail(this, uri, android.graphics.Size(1, 1), null)
                    null // 不是文档 URI, 继续尝试
                } catch (_: Exception) {
                    resolveDocumentsContractPath(uri)
                }
            }

            // 通用 ContentResolver 查询
            val cursor = contentResolver.query(uri, null, null, null, null)
            cursor?.use { c ->
                if (c.moveToFirst()) {
                    val idx = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                    // 返回 data 列（存储文件路径的列，存在因 Provider 而异）
                    for (col in c.columnNames) {
                        if (col.equals("_data", ignoreCase = true)) {
                            return c.getString(c.getColumnIndex(col))
                        }
                    }
                }
            }
        }

        return null
    }

    private fun resolveDocumentsContractPath(uri: Uri): String? {
        // 处理 external storage documents
        if (!android.provider.DocumentsContract.isDocumentUri(this, uri)) return null

        val docId = android.provider.DocumentsContract.getDocumentId(uri)
        val parts = docId.split(":")

        if (parts.size >= 2) {
            val type = parts[0]
            val relPath = parts[1]
            val ext = android.os.Environment.getExternalStorageDirectory()
            return when {
                type == "primary" -> "${ext.absolutePath}/$relPath"
                type.startsWith("home") -> "${ext.absolutePath}/$relPath"
                else -> "/storage/$type/$relPath"
            }
        }

        return "/storage/emulated/0/$docId"
    }

    companion object {
        private const val PREFS_NAME = "adojas_prefs"
        private const val PREF_FIRST_LAUNCH = "first_launch"
        private const val REQUEST_STORAGE_PERM = 1001
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        router.register(FilePlugin(this))
        router.register(DevicePlugin(this))
        router.register(AudioPlugin(this))
        router.register(NetworkPlugin(this))

        // 请求外部存储权限（文件读写）
        requestStoragePermission()

        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        if (prefs.getBoolean(PREF_FIRST_LAUNCH, true)) {
            showWelcome()
        } else {
            initWebView()
            loadWebApp()
        }
    }

    // ========================================================================
    // 存储权限（API 23+ 需要运行时申请）
    // ========================================================================

    private fun requestStoragePermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return

        val perms = mutableListOf<String>()
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE)
            != PackageManager.PERMISSION_GRANTED
        ) {
            perms.add(Manifest.permission.READ_EXTERNAL_STORAGE)
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE)
            != PackageManager.PERMISSION_GRANTED
        ) {
            perms.add(Manifest.permission.WRITE_EXTERNAL_STORAGE)
        }

        if (perms.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, perms.toTypedArray(), REQUEST_STORAGE_PERM)
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_STORAGE_PERM) {
            val granted = grantResults.all { it == PackageManager.PERMISSION_GRANTED }
            // 即使拒绝，WebView 仍会加载，但外部文件将不可读
        }
    }

    // ========================================================================
    // 欢迎页
    // ========================================================================

    private fun showWelcome() {
        findViewById<MaterialButton>(R.id.btn_start).setOnClickListener {
            getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit().putBoolean(PREF_FIRST_LAUNCH, false).apply()

            initWebView()
            loadWebApp()

            findViewById<View>(R.id.welcome_container).visibility = View.GONE
            findViewById<FrameLayout>(R.id.webview_container).visibility = View.VISIBLE
        }
    }

    // ========================================================================
    // WebView
    // ========================================================================

    @SuppressLint("SetJavaScriptEnabled")
    private fun initWebView() {
        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = true
            settings.allowContentAccess = true
            settings.setSupportMultipleWindows(false)
            settings.allowFileAccessFromFileURLs = true
            settings.allowUniversalAccessFromFileURLs = true
            setLayerType(WebView.LAYER_TYPE_HARDWARE, null)

            addJavascriptInterface(
                AdojasBridge(router) { resultJson ->
                    runOnUiThread {
                        evaluateJavascript("window.__adojas_onResult($resultJson)", null)
                    }
                },
                "AdojasBridge"
            )

            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                }
            }

            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    view: WebView?,
                    filePathCallback: ValueCallback<Array<Uri>>?,
                    fileChooserParams: FileChooserParams?
                ): Boolean {
                    fileChooserCallback = filePathCallback

                    val intent = (fileChooserParams?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT)).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        if (type == null || type.isEmpty()) type = "*/*"
                    }

                    fileChooserLauncher.launch(intent)
                    return true
                }
            }
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
}
