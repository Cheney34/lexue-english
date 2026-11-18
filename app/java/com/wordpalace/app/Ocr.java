package com.wordpalace.app;

import android.content.Context;
import android.graphics.Bitmap;

import com.googlecode.tesseract.android.TessBaseAPI;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;

/**
 * 离线 OCR（Tesseract 5，LSTM 英文模型），首次使用时把 assets 中的
 * 语言包释放到内部存储，之后完全离线运行。
 */
public class Ocr {

    private static final String LANG = "eng";
    private static final String ASSERT_DIR = "tessdata";

    private final Context ctx;
    private TessBaseAPI api;
    private boolean failed;

    public Ocr(Context ctx) {
        this.ctx = ctx.getApplicationContext();
    }

    public synchronized boolean isReady() {
        return api != null;
    }

    public synchronized String recognize(byte[] jpeg) {
        if (failed) return null;
        try {
            ensureInit();
            if (api == null) return null;
            Bitmap bmp = ImageUtil.decode(jpeg, 2000);
            if (bmp == null) return null;
            api.setImage(bmp);
            String text = api.getUTF8Text();
            bmp.recycle();
            return text == null ? "" : text;
        } catch (Throwable t) {
            return null;
        }
    }

    private void ensureInit() throws Exception {
        if (api != null) return;
        File dataDir = ctx.getFilesDir();
        File target = new File(new File(dataDir, ASSERT_DIR), LANG + ".traineddata");
        if (!target.exists() || target.length() < 1024) {
            if (!target.getParentFile().exists() && !target.getParentFile().mkdirs()) {
                throw new IllegalStateException("mkdir tessdata failed");
            }
            InputStream in = null;
            FileOutputStream out = null;
            try {
                in = ctx.getAssets().open(ASSERT_DIR + "/" + LANG + ".traineddata");
                out = new FileOutputStream(target);
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                out.flush();
            } finally {
                ImageUtil.close(out);
                ImageUtil.close(in);
            }
        }

        TessBaseAPI a = new TessBaseAPI();
        boolean ok = a.init(dataDir.getAbsolutePath(), LANG);
        if (!ok) {
            a.recycle();
            failed = true;
            throw new IllegalStateException("tesseract init failed");
        }
        a.setPageSegMode(TessBaseAPI.PageSegMode.PSM_AUTO);
        a.setVariable(TessBaseAPI.VAR_CHAR_WHITELIST, "");
        api = a;
    }

    public synchronized void shutdown() {
        if (api != null) {
            try { api.recycle(); } catch (Throwable ignored) {}
            api = null;
        }
    }
}
