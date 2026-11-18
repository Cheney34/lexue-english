package com.wordpalace.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.text.TextUtils;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * 极简 ContentProvider：仅用于把应用缓存目录里的临时拍照文件
 * 以 content:// 形式授权给系统相机应用写入，替代 FileProvider
 * （本项目不依赖 AndroidX，因此不使用 androidx 的 FileProvider）。
 */
public class CaptureProvider extends ContentProvider {

    public static final String AUTHORITY = "com.wordpalace.app.capture";

    public static Uri uriFor(String fileName) {
        return Uri.parse("content://" + AUTHORITY + "/" + fileName);
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    private File resolve(Uri uri) throws FileNotFoundException {
        String name = uri.getLastPathSegment();
        if (TextUtils.isEmpty(name) || !name.matches("[A-Za-z0-9_.\\-]+")) {
            throw new FileNotFoundException("bad name");
        }
        if (getContext() == null) throw new FileNotFoundException("no context");
        return new File(getContext().getCacheDir(), name);
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File f = resolve(uri);
        int flags = ParcelFileDescriptor.MODE_CREATE | ParcelFileDescriptor.MODE_TRUNCATE;
        flags |= "r".equals(mode) ? ParcelFileDescriptor.MODE_READ_ONLY
                                  : ParcelFileDescriptor.MODE_READ_WRITE;
        return ParcelFileDescriptor.open(f, flags);
    }

    @Override
    public String getType(Uri uri) {
        return "image/jpeg";
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        try {
            File f = resolve(uri);
            return f.delete() ? 1 : 0;
        } catch (Exception e) {
            return 0;
        }
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection,
                        String[] selectionArgs, String sortOrder) {
        return null;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
