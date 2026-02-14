# Keep WebView JavaScript interface methods
-keepclassmembers class com.privatechat.app.MainActivity$ClipboardBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepclassmembers class com.privatechat.app.MainActivity$TurnBridge {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep JavascriptInterface annotation
-keepattributes JavascriptInterface

# Keep MainActivity (entry point)
-keep class com.privatechat.app.MainActivity { *; }

# WebView
-keepclassmembers class * extends android.webkit.WebViewClient {
    public void *(android.webkit.WebView, java.lang.String);
}
