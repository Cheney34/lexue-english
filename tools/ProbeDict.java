import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Probe the online-dictionary endpoints with exactly the headers Net.java sends,
 * so we know whether the failure is server-side (403 / dead endpoint) or client-side.
 *
 * Usage: java ProbeDict.java
 * Output is ASCII-escaped so the Windows console code page cannot garble it.
 */
public class ProbeDict {

    static final String UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 "
            + "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

    public static void main(String[] args) {
        String[][] cases = new String[][] {
            // { label, url, extraHeaders("key:value;key:value" or "") }
            { "youdao-jsonapi", "https://dict.youdao.com/jsonapi?q=teacher", "" },
            { "youdao-jsonapi-ref", "https://dict.youdao.com/jsonapi?q=teacher", "Referer:https://dict.youdao.com/" },
            { "youdao-suggest", "https://dict.youdao.com/suggest?num=5&ver=3.0&doctype=json&cache=false&le=en&q=teacher", "" },
            { "youdao-suggest-ref", "https://dict.youdao.com/suggest?num=5&ver=3.0&doctype=json&cache=false&le=en&q=teacher", "Referer:https://dict.youdao.com/" },
            { "dictionaryapi", "https://api.dictionaryapi.dev/api/v2/entries/en/teacher", "" },
            { "mymemory", "https://api.mymemory.translated.net/get?q=teacher&langpair=en|zh-CN", "" },
            { "iciba-html", "https://www.iciba.com/word?w=teacher", "" },
            { "bing-dict", "https://cn.bing.com/dict/search?q=teacher", "" },
            { "youdao-html", "https://dict.youdao.com/w/eng/teacher/", "" },
            { "baidu", "https://www.baidu.com/", "" },
            { "peoplecn", "http://www.people.com.cn/", "" }
        };
        for (String[] c : cases) {
            probe(c[0], c[1], c[2]);
        }
    }

    static void probe(String label, String url, String extra) {
        long t0 = System.currentTimeMillis();
        String out;
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(2500);
            c.setReadTimeout(2000);
            c.setRequestMethod("GET");
            c.setInstanceFollowRedirects(true);
            c.setRequestProperty("User-Agent", UA);
            c.setRequestProperty("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,"
                    + "application/rss+xml;q=0.9,application/json;q=0.8,*/*;q=0.7");
            c.setRequestProperty("Accept-Language", "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7");
            c.setRequestProperty("Upgrade-Insecure-Requests", "1");
            c.setRequestProperty("sec-ch-ua", "\"Chromium\";v=\"120\", \"Not:A-Brand\";v=\"99\"");
            c.setRequestProperty("sec-ch-ua-mobile", "?1");
            c.setRequestProperty("sec-ch-ua-platform", "\"Android\"");
            c.setRequestProperty("sec-fetch-dest", "document");
            c.setRequestProperty("sec-fetch-mode", "navigate");
            c.setRequestProperty("sec-fetch-site", "none");
            c.setRequestProperty("sec-fetch-user", "?1");
            c.setRequestProperty("Cache-Control", "no-cache");
            c.setRequestProperty("Pragma", "no-cache");
            for (Map.Entry<String, String> e : parseExtra(extra).entrySet()) {
                c.setRequestProperty(e.getKey(), e.getValue());
            }
            int code = c.getResponseCode();
            String ctype = String.valueOf(c.getHeaderField("Content-Type"));
            InputStream is = (code >= 400) ? c.getErrorStream() : c.getInputStream();
            byte[] body = read(is);
            out = "status=" + code + " type=" + ctype + " bytes=" + body.length
                    + " head=" + ascii(new String(body, 0, Math.min(240, body.length), "UTF-8"));
            c.disconnect();
        } catch (Throwable t) {
            out = "EXCEPTION " + t.getClass().getSimpleName() + ": " + ascii(String.valueOf(t.getMessage()));
        }
        long ms = System.currentTimeMillis() - t0;
        System.out.println("--- " + label + " (" + ms + "ms)");
        System.out.println("    " + out);
        System.out.flush();
    }

    static Map<String, String> parseExtra(String s) {
        Map<String, String> m = new LinkedHashMap<String, String>();
        if (s == null || s.length() == 0) return m;
        for (String part : s.split(";")) {
            int i = part.indexOf(':');
            if (i > 0) m.put(part.substring(0, i), part.substring(i + 1));
        }
        return m;
    }

    static byte[] read(InputStream is) throws Exception {
        if (is == null) return new byte[0];
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
        is.close();
        return bos.toByteArray();
    }

    static String ascii(String s) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            if (ch >= 32 && ch < 127) sb.append(ch);
            else sb.append(String.format("\\u%04x", (int) ch));
        }
        return sb.toString();
    }
}
