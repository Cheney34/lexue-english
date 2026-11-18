package com.wordpalace.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.Vibrator;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.webkit.JavascriptInterface;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.util.ArrayDeque;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * JS ⇄ 原生 桥。
 *
 * 约定（务必与 assets/www/js/bridge.js 保持一致）：
 *   1) 所有需要异步返回的方法，**第一个参数固定是 callId**，
 *      其余业务参数按顺序跟在后面；
 *   2) 原生完成后调用页面上的 window.__nb(callId, jsonString) 回填 Promise。
 * 参数顺序一旦错位，请求会静默失败并最终表现为「超时」——构建时由
 * tools/check_bridge.py 静态校验，避免再次踩坑。
 */
public class Bridge {

    private static final int REQ_PICK = 1001;
    private static final int REQ_CAMERA = 1002;
    private static final int REQ_FILE = 1003;

    private final Activity act;
    private final WebView web;
    private final ViewGroup host;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService pool = Executors.newFixedThreadPool(3);
    private final Ocr ocr;
    private final Tts tts;

    private String pendingPickCall;
    private File pendingCapture;
    private String pendingFileCall;

    public Bridge(Activity act, WebView web, ViewGroup host) {
        this.act = act;
        this.web = web;
        this.host = host;
        this.ocr = new Ocr(act);
        this.tts = new Tts(act);
    }

    /* ============================ 基础信息 ============================ */

    @JavascriptInterface
    public String platform() {
        JSONObject o = new JSONObject();
        try {
            o.put("name", "android");
            o.put("sdk", Build.VERSION.SDK_INT);
            o.put("release", Build.VERSION.RELEASE);
            o.put("model", Build.MODEL);
            o.put("brand", Build.BRAND);
            o.put("version", "1.0");
            String abi = "";
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP
                    && Build.SUPPORTED_ABIS != null && Build.SUPPORTED_ABIS.length > 0) {
                abi = Build.SUPPORTED_ABIS[0];
            }
            o.put("abi", abi);
            o.put("tts", tts.available());
            o.put("ocr", true);
        } catch (Throwable ignored) {}
        return o.toString();
    }

    @JavascriptInterface
    public void toast(String msg) {
        final String m = msg == null ? "" : msg;
        main.post(() -> {
            try {
                Toast.makeText(act, m, Toast.LENGTH_SHORT).show();
            } catch (Throwable ignored) {}
        });
    }

    @JavascriptInterface
    public void vibrate(int ms) {
        try {
            Vibrator v = (Vibrator) act.getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null && v.hasVibrator()) v.vibrate(Math.max(1, Math.min(ms, 200)));
        } catch (Throwable ignored) {}
    }

    @JavascriptInterface
    public void copy(String text) {
        try {
            ClipboardManager cm = (ClipboardManager) act.getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("word", text == null ? "" : text));
        } catch (Throwable ignored) {}
    }

    @JavascriptInterface
    public void openExternal(String url) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            act.startActivity(i);
        } catch (Throwable t) {
            toast("无法打开链接");
        }
    }

    @JavascriptInterface
    public void exitApp() {
        main.post(() -> {
            try { act.finish(); } catch (Throwable ignored) {}
        });
    }

    /* ===================== 系统深浅色（原生为准） ===================== */

    /**
     * 系统当前是不是深色模式。
     *
     * 为什么不让网页自己用 prefers-color-scheme：部分国产 ROM 的 WebView
     * 根本不把系统深色透给媒体查询（一直是 light），而且在 WebView 里做
     * 「算法深色」又会把已经适配好的浅色界面反相成一片灰。所以以原生
     * Configuration.uiMode 为准，网页只认这个。
     */
    @JavascriptInterface
    public boolean isSystemDark() {
        try {
            int mode = act.getResources().getConfiguration().uiMode
                    & Configuration.UI_MODE_NIGHT_MASK;
            return mode == Configuration.UI_MODE_NIGHT_YES;
        } catch (Throwable t) {
            return false;
        }
    }

    /* ============================ 语音朗读 ============================ */

    @JavascriptInterface
    public void speak(String text, float rate) {
        if (!tts.available()) {
            // 引擎确实起不来：告诉设置页可以跳系统语音设置，而不是只说「不能朗读」
            toast("未检测到系统语音引擎，可在「设置 → 发音引擎」里配置");
            return;
        }
        tts.speak(text, rate);
    }

    @JavascriptInterface
    public void stopSpeak() {
        tts.stop();
    }

    /** 发音引擎的详细状态（JSON 字符串），诊断面板与设置页都读它 */
    @JavascriptInterface
    public String ttsInfo() {
        try {
            return tts.info();
        } catch (Throwable t) {
            return "{\"available\":false,\"note\":\"" + t + "\"}";
        }
    }

    /** mode: auto（优先英语）| system（系统默认引擎默认语音） */
    @JavascriptInterface
    public void setTtsMode(String mode) {
        try {
            tts.setMode(mode);
        } catch (Throwable ignored) {}
    }

    /** 跳系统「文字转语音」设置，用户可以自己装/换英语语音 */
    @JavascriptInterface
    public void openTtsSettings() {
        main.post(() -> {
            try {
                tts.openSettings();
            } catch (Throwable ignored) {}
        });
    }

    /* ============================== 取图 ============================== */

    @JavascriptInterface
    public void pickImages(String callId, String source) {
        if (pendingPickCall != null) {
            resolveError(callId, "上一次取图尚未结束");
            return;
        }
        pendingPickCall = callId;
        main.post(() -> {
            try {
                if ("camera".equals(source)) startCamera();
                else startGallery();
            } catch (Throwable t) {
                failPending("无法打开" + ("camera".equals(source) ? "相机" : "相册"));
            }
        });
    }

    private void startGallery() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("image/*");
        i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        act.startActivityForResult(i, REQ_PICK);
    }

    private void startCamera() {
        File f = new File(act.getCacheDir(), "cap_" + System.currentTimeMillis() + ".jpg");
        Uri u = CaptureProvider.uriFor(f.getName());
        pendingCapture = f;
        Intent i = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        i.putExtra(MediaStore.EXTRA_OUTPUT, u);
        i.setClipData(ClipData.newUri(act.getContentResolver(), "capture", u));
        i.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        act.startActivityForResult(i, REQ_CAMERA);
    }

    public boolean onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE) {
            final String fc = pendingFileCall;
            pendingFileCall = null;
            if (fc == null) return true;
            if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
                resolveError(fc, "cancelled");
                return true;
            }
            final Uri fu = data.getData();
            pool.execute(() -> resolve(fc, readTextFile(fu)));
            return true;
        }
        if (requestCode != REQ_PICK && requestCode != REQ_CAMERA) return false;
        final String callId = pendingPickCall;
        pendingPickCall = null;
        if (callId == null) return true;

        if (requestCode == REQ_PICK) {
            if (resultCode != Activity.RESULT_OK || data == null) {
                resolveError(callId, "cancelled");
                return true;
            }
            final List<Uri> uris = new ArrayList<>();
            try {
                if (data.getClipData() != null) {
                    ClipData cd = data.getClipData();
                    for (int i = 0; i < cd.getItemCount(); i++) {
                        Uri u = cd.getItemAt(i).getUri();
                        if (u != null) uris.add(u);
                    }
                } else if (data.getData() != null) {
                    uris.add(data.getData());
                }
            } catch (Throwable ignored) {}
            if (uris.isEmpty()) {
                resolveError(callId, "没有选择图片");
                return true;
            }
            pool.execute(() -> resolve(callId, readImages(uris)));
        } else {
            final File f = pendingCapture;
            pendingCapture = null;
            if (resultCode != Activity.RESULT_OK) {
                deleteQuietly(f);
                resolveError(callId, "cancelled");
                return true;
            }
            if (f == null || !f.exists() || f.length() == 0) {
                deleteQuietly(f);
                resolveError(callId, "拍照失败");
                return true;
            }
            pool.execute(() -> {
                JSONObject o = readImages(Collections.singletonList(Uri.fromFile(f)));
                deleteQuietly(f);
                resolve(callId, o);
            });
        }
        return true;
    }

    private JSONObject readImages(List<Uri> uris) {
        JSONObject o = new JSONObject();
        org.json.JSONArray arr = new org.json.JSONArray();
        try {
            for (Uri u : uris) {
                byte[] jpeg = ImageUtil.loadJpeg(act, u, ImageUtil.MAX_EDGE);
                if (jpeg == null) continue;
                JSONObject img = new JSONObject();
                img.put("dataUrl", ImageUtil.toDataUrl(jpeg));
                img.put("bytes", jpeg.length);
                arr.put(img);
            }
            if (arr.length() == 0) {
                o.put("ok", false);
                o.put("error", "图片读取失败");
            } else {
                o.put("ok", true);
                o.put("images", arr);
            }
        } catch (Throwable t) {
            try {
                o.put("ok", false);
                o.put("error", String.valueOf(t.getMessage()));
            } catch (Throwable ignored) {}
        }
        return o;
    }

    /* ========================= 文本文件（OPML 导入导出） ========================= */

    /**
     * 选择一个文本文件并读回内容。
     * 用 ACTION_OPEN_DOCUMENT，由系统选择器授予临时读权限，因此不需要申请任何存储权限。
     * MIME 类型统一给通配类型，因为不少文件管理器不会把 .opml 映射到 text/xml。
     */
    @JavascriptInterface
    public void pickTextFile(String callId, String mime) {
        if (pendingFileCall != null) {
            resolveError(callId, "上一次选择尚未结束");
            return;
        }
        pendingFileCall = callId;
        final String m = (mime == null || mime.isEmpty()) ? "*/*" : mime;
        main.post(() -> {
            try {
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType(m);
                i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"text/xml", "text/x-opml",
                        "application/xml", "text/plain", "*/*"});
                act.startActivityForResult(i, REQ_FILE);
            } catch (Throwable t) {
                failFile("无法打开文件选择器");
            }
        });
    }

    private void failFile(String msg) {
        final String c = pendingFileCall;
        pendingFileCall = null;
        if (c != null) resolveError(c, msg);
    }

    private JSONObject readTextFile(Uri u) {
        JSONObject o = new JSONObject();
        InputStream in = null;
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        try {
            in = act.getContentResolver().openInputStream(u);
            if (in == null) throw new IllegalStateException("无法读取该文件");
            byte[] buf = new byte[8192];
            int n, total = 0;
            while ((n = in.read(buf)) > 0) {
                bos.write(buf, 0, n);
                total += n;
                if (total > 4 * 1024 * 1024) throw new IllegalStateException("文件超过 4MB");
            }
            byte[] data = bos.toByteArray();

            String name = "feeds.opml";
            try {
                android.database.Cursor c = act.getContentResolver()
                        .query(u, null, null, null, null);
                if (c != null) {
                    int idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (c.moveToFirst() && idx >= 0) {
                        String v = c.getString(idx);
                        if (v != null && !v.isEmpty()) name = v;
                    }
                    c.close();
                }
            } catch (Throwable ignored) {}

            // 与网络请求共用同一套编码判定：HTTP 头没有 charset 时看 XML 声明，再回退
            String cs = Net.sniffXmlEncoding(data);
            o.put("ok", true);
            o.put("name", name);
            o.put("bytes", data.length);
            o.put("text", Net.decodeWithFallback(data, cs == null ? "UTF-8" : cs));
        } catch (Throwable t) {
            try {
                o.put("ok", false);
                o.put("error", String.valueOf(t.getMessage()));
            } catch (Throwable ignored) {}
        } finally {
            ImageUtil.close(in);
        }
        return o;
    }

    /**
     * 把文本保存成文件。
     * API 29+ 走 MediaStore 直接落到系统「下载」目录（无需任何权限）；
     * 更低版本落到应用自己的外部目录，同样不需要权限。
     */
    @JavascriptInterface
    public void saveFile(final String callId, final String name, final String text,
                         final String mime) {
        main.post(() -> pool.execute(() -> {
            JSONObject o = new JSONObject();
            String safe = (name == null || name.isEmpty()) ? "wordpalace.txt" : name;
            safe = safe.replaceAll("[/\\\\:*?\"<>|]", "_");
            byte[] data = (text == null ? "" : text).getBytes(java.nio.charset.Charset.forName("UTF-8"));
            String type = (mime == null || mime.isEmpty()) ? "text/plain" : mime;

            try {
                if (Build.VERSION.SDK_INT >= 29) {
                    android.content.ContentValues cv = new android.content.ContentValues();
                    cv.put(MediaStore.Downloads.DISPLAY_NAME, safe);
                    cv.put(MediaStore.Downloads.MIME_TYPE, type);
                    cv.put(MediaStore.Downloads.IS_PENDING, 1);
                    Uri item = act.getContentResolver()
                            .insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                    if (item == null) throw new IllegalStateException("无法创建文件");
                    java.io.OutputStream os = act.getContentResolver().openOutputStream(item);
                    os.write(data);
                    os.flush();
                    ImageUtil.close(os);
                    cv.clear();
                    cv.put(MediaStore.Downloads.IS_PENDING, 0);
                    act.getContentResolver().update(item, cv, null, null);
                    o.put("ok", true);
                    o.put("name", safe);
                    o.put("path", "下载/" + safe);
                    o.put("uri", item.toString());
                } else {
                    File dir = act.getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS);
                    if (dir == null) dir = act.getFilesDir();
                    if (!dir.exists()) dir.mkdirs();
                    File f = new File(dir, safe);
                    FileOutputStream fos = new FileOutputStream(f);
                    fos.write(data);
                    fos.flush();
                    fos.close();
                    o.put("ok", true);
                    o.put("name", safe);
                    o.put("path", f.getAbsolutePath());
                }
            } catch (Throwable t) {
                try {
                    o.put("ok", false);
                    o.put("error", String.valueOf(t.getMessage()));
                } catch (Throwable ignored) {}
            }
            resolve(callId, o);
        }));
    }

    /* ============================== OCR ============================== */

    @JavascriptInterface
    public void ocr(final String callId, final String dataUrl) {
        pool.execute(() -> {
            JSONObject o = new JSONObject();
            try {
                byte[] jpeg = ImageUtil.fromDataUrl(dataUrl);
                if (jpeg == null) {
                    o.put("ok", false);
                    o.put("error", "图片数据无效");
                } else {
                    String text = ocr.recognize(jpeg);
                    if (text == null) {
                        o.put("ok", false);
                        o.put("error", "离线识别引擎初始化失败");
                    } else {
                        o.put("ok", true);
                        o.put("text", text);
                    }
                }
            } catch (Throwable t) {
                try {
                    o.put("ok", false);
                    o.put("error", String.valueOf(t.getMessage()));
                } catch (Throwable ignored) {}
            }
            resolve(callId, o);
        });
    }

    /* ============================== 网络 ============================== */

    @JavascriptInterface
    public void http(final String callId, final String method, final String url,
                     final String headersJson, final String body) {
        pool.execute(() -> {
            JSONObject o = new JSONObject();
            try {
                Map<String, String> headers = new HashMap<>();
                if (headersJson != null && headersJson.length() > 2) {
                    JSONObject h = new JSONObject(headersJson);
                    for (Iterator<String> it = h.keys(); it.hasNext(); ) {
                        String k = it.next();
                        headers.put(k, h.optString(k));
                    }
                }
                Net.Result r = Net.request(method, url, headers, body);
                o.put("ok", r.error == null);
                o.put("status", r.status);
                if (r.body != null) o.put("body", r.body);
                if (r.error != null) o.put("error", r.error);
            } catch (Throwable t) {
                try {
                    o.put("ok", false);
                    o.put("error", String.valueOf(t.getMessage()));
                } catch (Throwable ignored) {}
            }
            resolve(callId, o);
        });
    }

    /* ==================== 后备通道：用 WebView 网络栈抓取 ====================
     *
     * 有些站点的 WAF 会识别并拦截 HttpURLConnection（实测 CGTN 直接返回 403、
     * 中新社返回 HTML 拦截页），但完全相同的地址在浏览器里一切正常。
     * 所以这里留一条后备通道：用隐藏 WebView 加载目标地址，再用
     * document.documentElement.outerHTML 取回原始文档——它走的是和浏览器
     * 完全相同的网络栈与 TLS 指纹，这类拦截自然不成立。
     *
     * 加载是串行的（同时只处理一个），因为只有直连失败时才会用到，
     * 串行带来的延迟可以接受。
     * ====================================================================== */

    private static class FetchJob {
        final String callId;
        final String url;
        FetchJob(String callId, String url) { this.callId = callId; this.url = url; }
    }

    private final ArrayDeque<FetchJob> fetchQueue = new ArrayDeque<>();
    private WebView fetchView;
    private FetchJob fetchCurrent;

    /**
     * 隐藏 WebView 抓取的看门狗。
     *
     * 必须和 JS 的预算配对：feed.js 里 WEBVIEW_BUDGET = 7000ms，这里取 6000ms，
     * 保证原生一定先给结论（超时也要回一条错误），JS 才不会「等不到回信就自己超时」。
     *
     * 原来的值是 25000ms，而 JS 端只等 20s、再往下每源总预算只有 10s——
     * 结果是每次兜底都两边白等，而且这个隐藏 WebView 是串行队列（一次只跑一个），
     * 前一个没结束，后面所有源都排在队里一起被判无效。
     */
    private static final long FETCH_WATCHDOG_MS = 6000;

    @JavascriptInterface
    public void webFetch(final String callId, final String url) {
        if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) {
            resolveError(callId, "不支持的地址");
            return;
        }
        main.post(() -> {
            fetchQueue.add(new FetchJob(callId, url));
            pumpFetch();
        });
    }

    private void pumpFetch() {
        if (fetchCurrent != null || fetchQueue.isEmpty()) return;
        try {
            ensureFetchView();
        } catch (Throwable t) {
            while (!fetchQueue.isEmpty()) {
                resolveError(fetchQueue.poll().callId, "浏览器引擎不可用：" + t.getMessage());
            }
            return;
        }
        final FetchJob job = fetchQueue.poll();
        fetchCurrent = job;
        fetchStatus = 0;

        main.postDelayed(() -> {
            if (fetchCurrent == job) {
                fetchCurrent = null;
                resolveError(job.callId, "浏览器引擎请求超时（" + (FETCH_WATCHDOG_MS / 1000) + " 秒）");
                pumpFetch();
            }
        }, FETCH_WATCHDOG_MS);

        try {
            fetchView.loadUrl(job.url);
        } catch (Throwable t) {
            fetchCurrent = null;
            resolveError(job.callId, String.valueOf(t.getMessage()));
            pumpFetch();
        }
    }

    private void ensureFetchView() {
        if (fetchView != null) return;
        if (host == null) throw new IllegalStateException("没有可用的宿主容器");

        WebView v = new WebView(act);
        WebSettings st = v.getSettings();
        st.setJavaScriptEnabled(true);
        st.setDomStorageEnabled(false);
        st.setAllowFileAccess(false);
        st.setSupportZoom(false);
        st.setBlockNetworkImage(true);   // 只要文档本身，不加载图片
        // 本应用的页面跑在 https://appassets.local 下，而订阅源里有 http 站点。
        // 默认的混合内容策略会把这种跳转拦掉，所以这条后备通道显式放开。
        try {
            st.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        } catch (Throwable ignored) {}
        v.setBackgroundColor(0);

        v.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request,
                                            WebResourceResponse err) {
                try {
                    if (request.isForMainFrame()) fetchStatus = err.getStatusCode();
                } catch (Throwable ignored) {}
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                view.evaluateJavascript(
                        "(function(){try{return document.documentElement"
                                + "?document.documentElement.outerHTML:'';}catch(e){return '';}})()",
                        value -> {
                            final FetchJob job = fetchCurrent;
                            if (job == null) return;
                            fetchCurrent = null;

                            String body = unquoteJsString(value);
                            JSONObject o = new JSONObject();
                            try {
                                int code = fetchStatus == 0 ? 200 : fetchStatus;
                                o.put("ok", code >= 200 && code < 400);
                                o.put("status", code);
                                o.put("via", "webview");
                                o.put("body", body.length() > 900000
                                        ? body.substring(0, 900000) : body);
                            } catch (Throwable ignored) {}
                            resolve(job.callId, o);
                            pumpFetch();
                        });
            }
        });

        host.addView(v, 0, new ViewGroup.LayoutParams(1, 1));
        fetchView = v;
    }

    private int fetchStatus;

    /**
     * evaluateJavascript 的返回值本身就是一个 JSON 字符串字面量，
     * 用 JSON 解析器还原即可，不需要手写转义（手写很容易出错）。
     */
    private static String unquoteJsString(String v) {
        if (v == null || "null".equals(v) || v.isEmpty()) return "";
        try {
            return new org.json.JSONArray("[" + v + "]").getString(0);
        } catch (Throwable t) {
            return v;
        }
    }

    /* ============================ 内部工具 ============================ */

    private void failPending(String msg) {
        String callId = pendingPickCall;
        pendingPickCall = null;
        if (pendingCapture != null) {
            deleteQuietly(pendingCapture);
            pendingCapture = null;
        }
        resolveError(callId, msg);
    }

    private void resolveError(String callId, String error) {
        JSONObject o = new JSONObject();
        try {
            o.put("ok", false);
            o.put("error", error == null ? "未知错误" : error);
        } catch (Throwable ignored) {}
        resolve(callId, o);
    }

    private void resolve(final String callId, final JSONObject obj) {
        if (callId == null || obj == null) return;
        final String js = "window.__nb&&window.__nb(" + jsStr(callId) + "," + jsStr(obj.toString()) + ")";
        main.post(() -> {
            try {
                if (web != null) web.evaluateJavascript(js, null);
            } catch (Throwable ignored) {}
        });
    }

    private static String jsStr(String s) {
        StringBuilder sb = new StringBuilder(s.length() + 16);
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"':  sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n");  break;
                case '\r': sb.append("\\r");  break;
                case '\t': sb.append("\\t");  break;
                case '\u2028': sb.append("\\u2028"); break;
                case '\u2029': sb.append("\\u2029"); break;
                default:
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        sb.append('"');
        return sb.toString();
    }

    private static void deleteQuietly(File f) {
        try {
            if (f != null && f.exists()) f.delete();
        } catch (Throwable ignored) {}
    }

    public void shutdown() {
        try {
            if (pendingPickCall != null) pendingPickCall = null;
            if (pendingCapture != null) deleteQuietly(pendingCapture);
            fetchQueue.clear();
            fetchCurrent = null;
            if (fetchView != null) {
                try {
                    fetchView.stopLoading();
                    if (host != null) host.removeView(fetchView);
                    fetchView.destroy();
                } catch (Throwable ignored) {}
                fetchView = null;
            }
            tts.shutdown();
            ocr.shutdown();
            pool.shutdownNow();
        } catch (Throwable ignored) {}
    }
}
