package com.wordpalace.app;


import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;

/**
 * 轻量 HTTP 客户端。放在原生层的原因：
 * 1) WebView 页面同源策略会阻止跨域抓取外刊 / 词典接口；
 * 2) 原生层可以设置浏览器 UA，兼容性更好；
 * 3) 统一限制最大响应体，避免异常大响应拖垮内存。
 */
public final class Net {

    private static final int MAX_BYTES = 4 * 1024 * 1024;

    public static class Result {
        public int status;
        public String body;
        public String error;
    }

    private Net() {}

    /** 从 XML 声明里猜编码：<?xml version="1.0" encoding="GBK"?> */
    /** 包内可见：Bridge 读取文本文件时也要用同一套编码判定 */
    static String sniffXmlEncoding(byte[] data) {
        try {
            int n = Math.min(data.length, 256);
            StringBuilder sb = new StringBuilder(n);
            for (int i = 0; i < n; i++) {
                char ch = (char) (data[i] & 0xFF);
                sb.append(ch);
            }
            String head = sb.toString().toLowerCase();
            int i = head.indexOf("encoding=");
            if (i < 0) return null;
            char q = i + 9 < head.length() ? head.charAt(i + 9) : '"';
            if (q != '"' && q != '\'') return null;
            int end = head.indexOf(q, i + 10);
            if (end < 0) return null;
            String v = head.substring(i + 10, end).trim();
            return (v.isEmpty() || v.length() > 24) ? null : v;
        } catch (Throwable t) {
            return null;
        }
    }

    /** 按声明的编码解码；失败则依次回退 UTF-8 / GBK，尽量不让内容变乱码 */
    static String decodeWithFallback(byte[] bytes, String cs) {
        String[] tries = {cs, "UTF-8", "GBK", "GB18030", "ISO-8859-1"};
        for (int i = 0; i < tries.length; i++) {
            String name = tries[i];
            if (name == null) continue;
            try {
                return new String(bytes, name);
            } catch (Throwable ignored) {
            }
        }
        return new String(bytes);
    }

    public static Result request(String method, String url,
                                 Map<String, String> headers, String body) {
        Result r = new Result();
        HttpURLConnection c = null;
        try {
            if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) {
                r.error = "不支持的地址";
                return r;
            }
            c = (HttpURLConnection) new URL(url).openConnection();
            // 这两个是「卡住多久算失败」的阈值，不是总时长：
            // 真正的总时长由 JS 侧给每个源 10 秒预算来控制，
            // 这里只要保证单个环节不会无限期挂住。
            //
            // 重要（改动前请先看 feed.js 顶部那段说明）：这两个数必须和 JS 的
            // DIRECT_BUDGET 配对——JS 会在 5.5 秒时放弃这次直连，所以原生在
            // 最坏情况下（连接 2.5s + 读取 2.0s = 4.5s）必须已经给出结论。
            // 之前的 3500 + 4500 = 8s 比 JS 的 7.5s 还长，结果是：只要网络稍慢，
            // 原生还在等，JS 就已经判定「超时」，直连通道看起来「所有源都无效」。
            c.setConnectTimeout(2500);
            c.setReadTimeout(2000);
            c.setRequestMethod(method == null ? "GET" : method.toUpperCase());
            c.setInstanceFollowRedirects(true);
            // 尽量贴近真实浏览器的请求特征。
            // 实测：部分站点（例如 CGTN）会对 HttpURLConnection 返回 403，
            // 而同样的地址在浏览器里正常——通常是 UA 里的非标准标记、
            // 或缺少 sec-ch-ua / sec-fetch-* 这类现代浏览器必带头导致的。
            // 这里补齐这些头；若仍被拦，会在上层自动改用 WebView 网络栈重试。
            c.setRequestProperty("User-Agent",
                    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 "
                            + "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36");
            c.setRequestProperty("Accept",
                    "text/html,application/xhtml+xml,application/xml;q=0.9,"
                            + "application/rss+xml;q=0.9,application/json;q=0.8,*/*;q=0.7");
            c.setRequestProperty("Accept-Language", "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7");
            c.setRequestProperty("Upgrade-Insecure-Requests", "1");
            c.setRequestProperty("sec-ch-ua",
                    "\"Chromium\";v=\"120\", \"Not:A-Brand\";v=\"99\"");
            c.setRequestProperty("sec-ch-ua-mobile", "?1");
            c.setRequestProperty("sec-ch-ua-platform", "\"Android\"");
            c.setRequestProperty("sec-fetch-dest", "document");
            c.setRequestProperty("sec-fetch-mode", "navigate");
            c.setRequestProperty("sec-fetch-site", "none");
            c.setRequestProperty("sec-fetch-user", "?1");
            c.setRequestProperty("Cache-Control", "no-cache");
            c.setRequestProperty("Pragma", "no-cache");
            if (headers != null) {
                for (Map.Entry<String, String> e : headers.entrySet()) {
                    if (e.getKey() != null && e.getValue() != null) {
                        c.setRequestProperty(e.getKey(), e.getValue());
                    }
                }
            }
            if (body != null) {
                byte[] b = body.getBytes("UTF-8");
                c.setDoOutput(true);
                c.setFixedLengthStreamingMode(b.length);
                OutputStream os = c.getOutputStream();
                os.write(b);
                os.flush();
                os.close();
            }

            r.status = c.getResponseCode();
            InputStream in = r.status >= 400 ? c.getErrorStream() : c.getInputStream();
            if (in != null) {
                ByteArrayOutputStream bos = new ByteArrayOutputStream(64 * 1024);
                byte[] buf = new byte[16384];
                int n;
                int total = 0;
                while ((n = in.read(buf)) > 0) {
                    bos.write(buf, 0, n);
                    total += n;
                    if (total >= MAX_BYTES) break;
                }
                ImageUtil.close(in);
                byte[] bytes = bos.toByteArray();

                // 编码判定，优先级：HTTP 头 charset > XML 声明里的 encoding > UTF-8
                // 很多中文源是 GBK/GB2312，而 HTTP 头往往不带 charset，
                // 硬按 UTF-8 解会得到乱码，XML 解析随之失败——这正是
                // 「浏览器打得开、应用解析不出」的另一个常见原因。
                String cs = null;
                String ct = c.getContentType();
                if (ct != null) {
                    int i = ct.toLowerCase().indexOf("charset=");
                    if (i >= 0) {
                        String v = ct.substring(i + 8).trim();
                        int sc = v.indexOf(';');
                        if (sc > 0) v = v.substring(0, sc);
                        v = v.replace("\"", "").trim();
                        if (!v.isEmpty() && v.length() < 24) cs = v;
                    }
                }
                if (cs == null) cs = sniffXmlEncoding(bytes);
                if (cs == null) cs = "UTF-8";

                r.body = decodeWithFallback(bytes, cs);
            } else {
                r.body = "";
            }
        } catch (Throwable t) {
            r.error = t.getClass().getSimpleName()
                    + (t.getMessage() == null ? "" : ": " + t.getMessage());
        } finally {
            if (c != null) {
                try { c.disconnect(); } catch (Throwable ignored) {}
            }
        }
        return r;
    }
}
