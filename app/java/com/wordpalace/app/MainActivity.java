package com.wordpalace.app;

import android.app.Activity;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.InputStream;

/**
 * 单词宫殿 —— 单 Activity + WebView 原生壳。
 *
 * 页面全部通过 https://appassets.local/ 由 shouldInterceptRequest 从 assets 提供，
 * 这样 WebView 拿到的是正常 https 源，IndexedDB / localStorage / fetch 均可正常使用，
 * 同时无需申请任何存储权限。
 *
 * 与 Android 14/15/16 + 国产 ROM（澎湃等）相关的三个加固：
 *   1) 深浅色以原生 Configuration.uiMode 为准，并**关掉 WebView 的算法深色**，
 *      否则 ROM 强制深色会把浅色界面反相成灰底灰字；
 *   2) 渲染进程被系统回收（onRenderProcessGone）时重建 WebView，不让应用直接闪退；
 *   3) 控制台与加载错误转发给页面（__wpLog / __wpNativeError），
 *      白屏时用户能在「诊断信息」里看到真实原因，不需要 adb。
 */
public class MainActivity extends Activity {

    private static final String TAG = "WordPalace";

    public static final String BASE_URL = "https://appassets.local/";
    private static final String HOST = "appassets.local";

    private static final int BG_DARK = 0xFF141A22;
    private static final int BG_LIGHT = 0xFFFFFFFF;

    private FrameLayout root;
    private WebView web;
    private Bridge bridge;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        root = new FrameLayout(this);
        root.setBackgroundColor(darkNow() ? BG_DARK : BG_LIGHT);
        setContentView(root);

        createWebView();
        web.loadUrl(BASE_URL + "index.html");
    }

    /** 建（或重建）WebView 及其全部设置与客户端 */
    private void createWebView() {
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        }

        web.setBackgroundColor(darkNow() ? BG_DARK : BG_LIGHT);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        applyWebDarkMode();

        bridge = new Bridge(this, web, root);
        web.addJavascriptInterface(bridge, "NativeBridge");
        web.setWebViewClient(new AssetClient());
        web.setWebChromeClient(new ConsoleClient());
    }

    /* ------------------------------------------------------------------ */
    /* 深浅色：以系统 uiMode 为准，不让 WebView 再插手                        */
    /* ------------------------------------------------------------------ */

    private boolean darkNow() {
        try {
            int mode = getResources().getConfiguration().uiMode
                    & Configuration.UI_MODE_NIGHT_MASK;
            return mode == Configuration.UI_MODE_NIGHT_YES;
        } catch (Throwable t) {
            return false;
        }
    }

    /**
     * 关掉 WebView 自己的「算法深色」。
     *
     * 界面已经按系统 uiMode 做了深浅色；如果放任 WebView 再套一层强制深色
     * （部分 ROM 默认强制开启），浅色界面会被反相成灰底灰字 —— 就是用户反馈的
     * 「默认深浅色有问题」。Android 13 起该开关叫 setAlgorithmicDarkeningAllowed，
     * 旧版本叫 setForceDark，两边都要关。
     */
    private void applyWebDarkMode() {
        if (web == null) return;
        WebSettings s = web.getSettings();
        try {
            if (Build.VERSION.SDK_INT >= 33) {
                s.setAlgorithmicDarkeningAllowed(false);
            } else if (Build.VERSION.SDK_INT >= 29) {
                s.setForceDark(WebSettings.FORCE_DARK_OFF);
            }
        } catch (Throwable ignored) {
        }
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // API 33+ 在配置变化后需要重新声明，否则又会被 ROM 套上强制深色
        applyWebDarkMode();
        int bg = darkNow() ? BG_DARK : BG_LIGHT;
        if (root != null) root.setBackgroundColor(bg);
        if (web != null) {
            web.setBackgroundColor(bg);
            // 让网页立刻跟着换，不用等下次启动
            web.evaluateJavascript(
                    "(window.Theme && Theme.onSystemChange) ? Theme.onSystemChange() : 0", null);
        }
    }

    /* ------------------------------------------------------------------ */
    /* 资源拦截：把 assets/www 与 assets/data 映射到 https://appassets.local/ */
    /* ------------------------------------------------------------------ */

    private class AssetClient extends WebViewClient {

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            return intercept(request.getUrl());
        }

        @Override
        @SuppressWarnings("deprecation")
        public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
            return intercept(Uri.parse(url));
        }

        private WebResourceResponse intercept(Uri uri) {
            if (uri == null) return null;
            String host = uri.getHost();
            if (host == null || !HOST.equals(host)) return null;

            String path = uri.getPath();
            if (path == null || path.length() == 0 || "/".equals(path)) path = "/index.html";
            while (path.startsWith("/")) path = path.substring(1);
            if (path.contains("..")) return notFound();

            try {
                InputStream in = openAsset(path);
                if (in == null) return notFound();
                WebResourceResponse r = new WebResourceResponse(mimeOf(path), charsetOf(path), in);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    r.setStatusCodeAndReasonPhrase(200, "OK");
                    // 数据文件较大，避免 WebView 缓存副本占用额外空间
                    if (path.endsWith(".json")) {
                        java.util.Map<String, String> h = new java.util.HashMap<>();
                        h.put("Cache-Control", "no-store");
                        r.setResponseHeaders(h);
                    }
                }
                return r;
            } catch (Exception e) {
                return notFound();
            }
        }

        /** www/ 映射到站点根目录，data/ 等其它资源保持 assets 原路径 */
        private InputStream openAsset(String path) {
            try {
                return getAssets().open(path);
            } catch (Exception ignored) {
            }
            try {
                return getAssets().open("www/" + path);
            } catch (Exception ignored) {
            }
            return null;
        }

        private WebResourceResponse notFound() {
            return new WebResourceResponse("text/plain", "utf-8",
                    new java.io.ByteArrayInputStream("404".getBytes()));
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return handleNav(request.getUrl().toString());
        }

        @Override
        @SuppressWarnings("deprecation")
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return handleNav(url);
        }

        private boolean handleNav(String url) {
            if (url == null) return false;
            if (url.startsWith(BASE_URL)) return false;
            if (url.startsWith("about:")) return false;
            try {
                Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
            } catch (Exception e) {
                Toast.makeText(MainActivity.this, "无法打开该链接", Toast.LENGTH_SHORT).show();
            }
            return true;
        }

        /* ---- 加载/渲染失败时把原因送到页面的诊断面板 ---- */

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            try {
                if (request != null && request.isForMainFrame()) {
                    CharSequence d = error == null ? "" : error.getDescription();
                    forwardError("onReceivedError", String.valueOf(d));
                }
            } catch (Throwable ignored) {}
        }

        @Override
        @SuppressWarnings("deprecation")
        public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
            try {
                if (failingUrl != null && failingUrl.startsWith(BASE_URL)) {
                    forwardError("onReceivedError", errorCode + " " + description);
                }
            } catch (Throwable ignored) {}
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request,
                                        WebResourceResponse response) {
            try {
                if (request != null && request.isForMainFrame()
                        && response != null && response.getStatusCode() >= 400) {
                    forwardError("onReceivedHttpError",
                            response.getStatusCode() + " " + request.getUrl());
                }
            } catch (Throwable ignored) {}
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // 渲染进程被系统杀掉（内存紧张 / 某些 ROM 的省电策略）：默认行为是
            // 整个应用崩掉。这里销毁重建，至少不闪退；页面数据在 IndexedDB 里，
            // 重新加载后仍在。
            boolean crashed = detail != null && detail.didCrash();
            Log.e(TAG, "onRenderProcessGone crashed=" + crashed);
            rebuildWebView(crashed);
            return true;
        }
    }

    /** 控制台日志转发给页面，白屏时用户能在「诊断信息」里看到报错 */
    private class ConsoleClient extends WebChromeClient {
        @Override
        public boolean onConsoleMessage(ConsoleMessage cm) {
            if (cm == null) return false;
            String where = cm.sourceId() == null ? "" : cm.sourceId();
            int slash = where.lastIndexOf('/');
            if (slash >= 0) where = where.substring(slash + 1);
            String line = cm.message() + " @" + where + ":" + cm.lineNumber();
            Log.i(TAG, "console[" + cm.messageLevel() + "] " + line);
            forwardLog(String.valueOf(cm.messageLevel()), line);
            return true;
        }
    }

    private void forwardLog(String level, String msg) {
        if (web == null) return;
        try {
            web.evaluateJavascript(
                    "window.__wpLog && window.__wpLog(" + jsStr(level) + "," + jsStr(msg) + ")",
                    null);
        } catch (Throwable ignored) {}
    }

    private void forwardError(String kind, String detail) {
        if (web == null) return;
        Log.e(TAG, "weberror " + kind + ": " + detail);
        try {
            web.evaluateJavascript(
                    "window.__wpNativeError && window.__wpNativeError("
                            + jsStr(kind) + "," + jsStr(detail) + ")",
                    null);
        } catch (Throwable ignored) {}
    }

    private static String jsStr(String s) {
        if (s == null) return "\"\"";
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"' || c == '\\') b.append('\\').append(c);
            else if (c == '\n') b.append("\\n");
            else if (c == '\r') b.append("\\r");
            else if (c == '\t') b.append("\\t");
            else if (c < 0x20) b.append(' ');
            else b.append(c);
        }
        return b.append('"').toString();
    }

    /** 渲染进程没了：拆掉旧 WebView 重建，保留 root 里的其他视图 */
    private void rebuildWebView(final boolean crashed) {
        try {
            if (root == null) return;
            if (bridge != null) {
                bridge.shutdown();
                bridge = null;
            }
            if (web != null) {
                try {
                    root.removeView(web);
                    web.removeJavascriptInterface("NativeBridge");
                    web.destroy();
                } catch (Throwable ignored) {}
                web = null;
            }
            createWebView();
            if (crashed) {
                Toast.makeText(this, "页面进程被系统回收，正在重新加载…", Toast.LENGTH_LONG).show();
            }
            web.loadUrl(BASE_URL + "index.html");
        } catch (Throwable t) {
            Log.e(TAG, "rebuildWebView failed: " + t);
        }
    }

    private static String mimeOf(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
        if (p.endsWith(".js")) return "application/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".woff")) return "font/woff";
        if (p.endsWith(".ttf")) return "font/ttf";
        return "application/octet-stream";
    }

    private static String charsetOf(String path) {
        String m = mimeOf(path);
        if (m.startsWith("text/") || m.contains("javascript") || m.contains("json") || m.contains("svg")) {
            return "utf-8";
        }
        return null;
    }

    /* ------------------------------------------------------------------ */
    /* 生命周期                                                             */
    /* ------------------------------------------------------------------ */

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (bridge != null && bridge.onActivityResult(requestCode, resultCode, data)) return;
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (web == null) {
            super.onBackPressed();
            return;
        }
        web.evaluateJavascript("(window.__wpBack && window.__wpBack()) ? 1 : 0", value -> {
            boolean handled = value != null && value.contains("1");
            if (!handled) MainActivity.super.onBackPressed();
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
        // 从系统设置回来后（用户可能刚装完语音引擎）让页面刷新一次发音状态
        if (web != null) {
            try {
                web.evaluateJavascript(
                        "window.Diag && Diag.refreshTts && Diag.refreshTts()", null);
            } catch (Throwable ignored) {}
        }
    }

    @Override
    protected void onPause() {
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (bridge != null) bridge.shutdown();
        if (web != null) {
            web.removeJavascriptInterface("NativeBridge");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
