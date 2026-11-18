import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;

/**
 * Probe sentence-level translation endpoints (EN -> ZH) with the same headers
 * Net.java sends, to decide which one the reader should use for 中英对照.
 *
 * Usage: java ProbeTranslate.java
 */
public class ProbeTranslate {

    static final String UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 "
            + "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

    static final String SHORT = "The government said on Monday that it would cut spending.";
    static final String LONG =
            "Researchers at the university have found that students who read for pleasure every day "
                    + "are better at understanding complex ideas. The study, which followed two thousand "
                    + "teenagers for three years, suggests that the habit matters more than the amount of "
                    + "time spent on homework alone.";

    public static void main(String[] args) {
        String e = enc(SHORT);
        String l = enc(LONG);
        probe("youdao-legacy-GET", "https://fanyi.youdao.com/translate?&doctype=json&type=EN2ZH_CN&i=" + e, null, null);
        probe("youdao-legacy-POST", "https://fanyi.youdao.com/translate?&doctype=json&type=EN2ZH_CN",
                "application/x-www-form-urlencoded", "i=" + e);
        probe("youdao-legacy-LONG", "https://fanyi.youdao.com/translate?&doctype=json&type=EN2ZH_CN&i=" + l, null, null);
        probe("youdao-jsonapi-sentence", "https://dict.youdao.com/jsonapi?q=" + e, null, null);
        probe("mymemory-short", "https://api.mymemory.translated.net/get?q=" + e + "&langpair=en|zh-CN", null, null);
        probe("mymemory-long", "https://api.mymemory.translated.net/get?q=" + l + "&langpair=en|zh-CN", null, null);
        probe("google-gtx", "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=" + e, null, null);
        probe("baidu-fanyi-web", "https://fanyi.baidu.com/transapi", "application/x-www-form-urlencoded",
                "from=en&to=zh&query=" + URLEncoder.encode(SHORT));
    }

    static String enc(String s) {
        try { return URLEncoder.encode(s, "UTF-8"); } catch (Exception ex) { return s; }
    }

    static void probe(String label, String url, String postType, String postBody) {
        long t0 = System.currentTimeMillis();
        String out;
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(2500);
            c.setReadTimeout(2000);
            c.setRequestMethod(postBody == null ? "GET" : "POST");
            c.setInstanceFollowRedirects(true);
            c.setRequestProperty("User-Agent", UA);
            c.setRequestProperty("Accept", "application/json,text/plain,*/*");
            c.setRequestProperty("Accept-Language", "en-US,en;q=0.9,zh-CN;q=0.8");
            c.setRequestProperty("Cache-Control", "no-cache");
            if (postBody != null) {
                byte[] b = postBody.getBytes("UTF-8");
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", postType);
                c.setFixedLengthStreamingMode(b.length);
                OutputStream os = c.getOutputStream();
                os.write(b);
                os.flush();
                os.close();
            }
            int code = c.getResponseCode();
            InputStream is = (code >= 400) ? c.getErrorStream() : c.getInputStream();
            byte[] body = read(is);
            out = "status=" + code + " bytes=" + body.length + " head="
                    + ascii(new String(body, 0, Math.min(420, body.length), "UTF-8"));
            c.disconnect();
        } catch (Throwable t) {
            out = "EXCEPTION " + t.getClass().getSimpleName() + ": " + ascii(String.valueOf(t.getMessage()));
        }
        System.out.println("--- " + label + " (" + (System.currentTimeMillis() - t0) + "ms)");
        System.out.println("    " + out);
        System.out.flush();
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
