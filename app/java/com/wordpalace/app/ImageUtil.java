package com.wordpalace.app;

import android.content.ContentResolver;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.net.Uri;
import android.os.Build;
import android.util.Base64;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;

/** 图片读取 / 采样 / 旋转 / 压缩 工具。 */
public final class ImageUtil {

    private ImageUtil() {}

    /** 最大边长（超过则等比缩小），兼顾清晰度与存储体积。 */
    public static final int MAX_EDGE = 1400;

    /** 从 content:// 或 file:// 读取并压缩为 JPEG 字节。 */
    public static byte[] loadJpeg(Context ctx, Uri uri, int maxEdge) {
        InputStream in = null;
        try {
            ContentResolver cr = ctx.getContentResolver();
            // 1) 只读边界，算采样率
            in = cr.openInputStream(uri);
            if (in == null) return null;
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inJustDecodeBounds = true;
            BitmapFactory.decodeStream(in, null, o);
            close(in);
            in = null;

            int sample = 1;
            int longer = Math.max(o.outWidth, o.outHeight);
            while (longer / sample > maxEdge * 2) sample *= 2;

            // 2) 真正解码
            in = cr.openInputStream(uri);
            BitmapFactory.Options o2 = new BitmapFactory.Options();
            o2.inSampleSize = sample;
            o2.inPreferredConfig = Bitmap.Config.ARGB_8888;
            Bitmap bmp = BitmapFactory.decodeStream(in, null, o2);
            close(in);
            in = null;
            if (bmp == null) return null;

            bmp = applyExif(ctx, uri, bmp);
            bmp = scaleDown(bmp, maxEdge);

            ByteArrayOutputStream bos = new ByteArrayOutputStream(256 * 1024);
            bmp.compress(Bitmap.CompressFormat.JPEG, 84, bos);
            bmp.recycle();
            return bos.toByteArray();
        } catch (Throwable t) {
            return null;
        } finally {
            close(in);
        }
    }

    public static String toDataUrl(byte[] jpeg) {
        if (jpeg == null) return null;
        return "data:image/jpeg;base64," + Base64.encodeToString(jpeg, Base64.NO_WRAP);
    }

    public static byte[] fromDataUrl(String dataUrl) {
        if (dataUrl == null) return null;
        int comma = dataUrl.indexOf(',');
        String b64 = comma >= 0 ? dataUrl.substring(comma + 1) : dataUrl;
        try {
            return Base64.decode(b64, Base64.DEFAULT);
        } catch (Throwable t) {
            return null;
        }
    }

    public static Bitmap decode(byte[] data, int maxEdge) {
        if (data == null) return null;
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(data, 0, data.length, o);
        int sample = 1;
        int longer = Math.max(o.outWidth, o.outHeight);
        while (longer / sample > maxEdge * 2) sample *= 2;
        BitmapFactory.Options o2 = new BitmapFactory.Options();
        o2.inSampleSize = sample;
        o2.inPreferredConfig = Bitmap.Config.ARGB_8888;
        Bitmap b = BitmapFactory.decodeByteArray(data, 0, data.length, o2);
        return scaleDown(b, maxEdge);
    }

    public static Bitmap scaleDown(Bitmap src, int maxEdge) {
        if (src == null) return null;
        int w = src.getWidth(), h = src.getHeight();
        int longer = Math.max(w, h);
        if (longer <= maxEdge) return src;
        float r = (float) maxEdge / longer;
        Bitmap out = Bitmap.createScaledBitmap(src, Math.round(w * r), Math.round(h * r), true);
        if (out != src) src.recycle();
        return out;
    }

    private static Bitmap applyExif(Context ctx, Uri uri, Bitmap bmp) {
        try {
            int deg = 0;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                InputStream in = ctx.getContentResolver().openInputStream(uri);
                android.media.ExifInterface ex = new android.media.ExifInterface(in);
                deg = exifDegrees(ex);
                close(in);
            } else {
                String path = uri.getPath();
                if (path != null && new File(path).exists()) {
                    android.media.ExifInterface ex = new android.media.ExifInterface(path);
                    deg = exifDegrees(ex);
                }
            }
            if (deg != 0) {
                Matrix m = new Matrix();
                m.postRotate(deg);
                Bitmap r = Bitmap.createBitmap(bmp, 0, 0, bmp.getWidth(), bmp.getHeight(), m, true);
                if (r != bmp) bmp.recycle();
                return r;
            }
        } catch (Throwable ignored) {
        }
        return bmp;
    }

    @SuppressWarnings("deprecation")
    private static int exifDegrees(android.media.ExifInterface ex) {
        int o = ex.getAttributeInt(android.media.ExifInterface.TAG_ORIENTATION, 1);
        switch (o) {
            case android.media.ExifInterface.ORIENTATION_ROTATE_90:  return 90;
            case android.media.ExifInterface.ORIENTATION_ROTATE_180: return 180;
            case android.media.ExifInterface.ORIENTATION_ROTATE_270: return 270;
            default: return 0;
        }
    }

    public static void close(java.io.Closeable c) {
        if (c != null) {
            try { c.close(); } catch (Throwable ignored) {}
        }
    }

    public static byte[] readFile(File f) {
        try {
            if (f == null || !f.exists()) return null;
            InputStream in = new java.io.FileInputStream(f);
            ByteArrayOutputStream bos = new ByteArrayOutputStream((int) f.length());
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            close(in);
            return bos.toByteArray();
        } catch (Throwable t) {
            return null;
        }
    }

    public static void writeFile(File f, byte[] data) {
        try {
            FileOutputStream out = new FileOutputStream(f);
            out.write(data);
            out.flush();
            out.close();
        } catch (Throwable ignored) {}
    }
}
