package com.privatechat.app;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

public class MainActivity extends AppCompatActivity {

    private WebView webView;
    private ValueCallback<Uri[]> fileUploadCallback;
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private static final int PERMISSION_REQUEST = 1002;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Fullscreen immersive mode with dark status bar
        getWindow().setStatusBarColor(0xFF0A0A0F);
        getWindow().setNavigationBarColor(0xFF0A0A0F);

        // Prevent screenshots for privacy
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        );

        // Keep screen on during calls
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // Create WebView programmatically
        webView = new WebView(this);
        setContentView(webView);

        setupWebView();
        requestPermissions();

        // Load the local HTML from assets
        webView.loadUrl("file:///android_asset/web/index.html");
    }

    private void setupWebView() {
        WebSettings settings = webView.getSettings();

        // Enable JavaScript (required)
        settings.setJavaScriptEnabled(true);

        // Enable DOM storage (for localStorage)
        settings.setDomStorageEnabled(true);

        // Enable WebRTC
        settings.setMediaPlaybackRequiresUserGesture(false);

        // Allow file access
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);

        // Do NOT enable AllowUniversalAccessFromFileURLs - security risk
        // TURN credentials are fetched via native TurnBridge instead

        // Enable mixed content (needed for some WebRTC)
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);

        // Cache settings
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);

        // User agent
        settings.setUserAgentString(settings.getUserAgentString() + " PrivateChat/1.0");

        // WebView client - handle navigation within app
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                // Keep local files in WebView, open external URLs in browser
                if (url.startsWith("file:///")) {
                    return false;
                }
                // Open external links in browser
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                startActivity(intent);
                return true;
            }
        });

        // Chrome client - handle permissions, file chooser, console
        webView.setWebChromeClient(new WebChromeClient() {

            // Handle WebRTC permission requests (microphone, camera)
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    String[] resources = request.getResources();
                    boolean hasAudio = false;
                    for (String resource : resources) {
                        if (resource.equals(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
                            hasAudio = true;
                        }
                    }

                    if (hasAudio) {
                        // Check Android permission
                        if (ContextCompat.checkSelfPermission(MainActivity.this,
                                Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                            request.grant(resources);
                        } else {
                            ActivityCompat.requestPermissions(MainActivity.this,
                                new String[]{Manifest.permission.RECORD_AUDIO},
                                PERMISSION_REQUEST);
                            // Grant anyway - permission will be checked when actually recording
                            request.grant(resources);
                        }
                    } else {
                        request.grant(resources);
                    }
                });
            }

            // Handle file chooser for file sharing
            @Override
            public boolean onShowFileChooser(WebView webView,
                    ValueCallback<Uri[]> callback,
                    FileChooserParams params) {
                if (fileUploadCallback != null) {
                    fileUploadCallback.onReceiveValue(null);
                }
                fileUploadCallback = callback;

                Intent intent = params.createIntent();
                try {
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                } catch (Exception e) {
                    fileUploadCallback = null;
                    Toast.makeText(MainActivity.this, "Cannot open file chooser", Toast.LENGTH_SHORT).show();
                    return false;
                }
                return true;
            }

            // Log console messages for debugging
            @Override
            public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
                android.util.Log.d("PrivateChat",
                    consoleMessage.message() + " -- line " +
                    consoleMessage.lineNumber() + " of " +
                    consoleMessage.sourceId());
                return true;
            }
        });

        // Add clipboard bridge (some WebViews restrict clipboard API)
        webView.addJavascriptInterface(new ClipboardBridge(), "AndroidClipboard");

        // Add TURN credential bridge (fetches Cloudflare TURN creds natively, avoids CORS)
        webView.addJavascriptInterface(new TurnBridge(), "AndroidTurn");
    }

    private void requestPermissions() {
        String[] permissions;
        if (Build.VERSION.SDK_INT >= 33) {
            permissions = new String[]{
                Manifest.permission.RECORD_AUDIO,
                Manifest.permission.READ_MEDIA_IMAGES
            };
        } else {
            permissions = new String[]{
                Manifest.permission.RECORD_AUDIO,
                Manifest.permission.READ_EXTERNAL_STORAGE
            };
        }

        boolean needRequest = false;
        for (String perm : permissions) {
            if (ContextCompat.checkSelfPermission(this, perm) != PackageManager.PERMISSION_GRANTED) {
                needRequest = true;
                break;
            }
        }

        if (needRequest) {
            ActivityCompat.requestPermissions(this, permissions, PERMISSION_REQUEST);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (fileUploadCallback != null) {
                Uri[] results = null;
                if (resultCode == Activity.RESULT_OK && data != null) {
                    String dataString = data.getDataString();
                    if (dataString != null) {
                        results = new Uri[]{Uri.parse(dataString)};
                    }
                }
                fileUploadCallback.onReceiveValue(results);
                fileUploadCallback = null;
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions,
            @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        // Permissions handled - WebRTC will work with granted ones
    }

    // Handle back button - go back in WebView history or exit
    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }

    // Bridge for fetching TURN credentials natively (avoids CORS in WebView)
    public class TurnBridge {
        @JavascriptInterface
        public String getCredentials() {
            try {
                java.net.URL url = new java.net.URL("https://speed.cloudflare.com/turn-creds");
                java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(5000);
                conn.setReadTimeout(5000);
                conn.setRequestMethod("GET");

                int code = conn.getResponseCode();
                if (code == 200) {
                    java.io.InputStream is = conn.getInputStream();
                    java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(is));
                    StringBuilder sb = new StringBuilder();
                    String line;
                    while ((line = reader.readLine()) != null) {
                        sb.append(line);
                    }
                    reader.close();
                    return sb.toString();
                }
                return "{\"error\":\"HTTP " + code + "\"}";
            } catch (Exception e) {
                return "{\"error\":\"" + e.getMessage().replace("\"", "'") + "\"}";
            }
        }
    }

    // Bridge for clipboard access from JavaScript
    public class ClipboardBridge {
        @JavascriptInterface
        public void copyToClipboard(String text) {
            ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            ClipData clip = ClipData.newPlainText("Private Chat", text);
            clipboard.setPrimaryClip(clip);
            runOnUiThread(() ->
                Toast.makeText(MainActivity.this, "Copied to clipboard", Toast.LENGTH_SHORT).show()
            );
        }

        @JavascriptInterface
        public String getFromClipboard() {
            ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (clipboard.hasPrimaryClip() && clipboard.getPrimaryClip().getItemCount() > 0) {
                CharSequence text = clipboard.getPrimaryClip().getItemAt(0).getText();
                return text != null ? text.toString() : "";
            }
            return "";
        }
    }
}
