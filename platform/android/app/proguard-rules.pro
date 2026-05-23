# ADOJAS Bridge — keep @JavascriptInterface methods
-keepclassmembers class com.adojas.android.bridge.AdojasBridge {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep plugin classes accessible via reflection (if used)
-keep class com.adojas.android.plugins.** { *; }
