package com.wordpalace.app;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.speech.tts.TextToSpeech;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Locale;
import java.util.Set;

/**
 * 系统 TTS 发音。
 *
 * 两种模式：
 *   auto   —— 优先英语（美式 → 英式）；英语语音没装时退回引擎默认语言，
 *             发音可能不标准，但总比完全没有声音好；
 *   system —— 直接用系统默认引擎的默认语言（用户要的「调用系统默认的」）。
 *
 * 关键修复（旧实现的两个坑）：
 *   1) 语言设不上（LANG_MISSING_DATA）曾被当成「没有语音引擎」，直接置
 *      unavailable 并且**永不重试**——表现就是点了没声音、界面上发音入口也
 *      像坏了。现在引擎只要活着就保留可用状态，把真实原因记进 note，
 *      交给诊断面板显示。
 *   2) 没有任何跳系统语音设置的路。现在提供 openSettings()，用户装上英语
 *      语音后回来就能用（同时保证引擎失败超过 5s 会自动重试一次）。
 */
public class Tts {

    private final Context ctx;
    private TextToSpeech tts;
    private volatile boolean engineReady;    // 引擎初始化完成
    private volatile boolean unavailable;    // 引擎本身起不来
    private String mode = "auto";            // auto | system
    private String langTag = "";
    private String engine = "";
    private String note = "";                // 出问题时的原因（诊断面板读它）
    private String pending;
    private float pendingRate = 1f;
    private long lastInitTry;

    public Tts(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        init();
    }

    private void init() {
        lastInitTry = System.currentTimeMillis();
        try {
            tts = new TextToSpeech(ctx, status -> {
                if (status != TextToSpeech.SUCCESS || tts == null) {
                    unavailable = true;
                    engineReady = false;
                    note = "引擎初始化失败 (status=" + status + ")";
                    return;
                }
                unavailable = false;
                engineReady = true;
                pickLanguage();
                if (pending != null) {
                    String p = pending;
                    pending = null;
                    speak(p, pendingRate);
                }
            });
        } catch (Throwable t) {
            unavailable = true;
            engineReady = false;
            note = "引擎初始化异常: " + t;
        }
    }

    /** 引擎曾经起不来时，隔一会儿再试一次（用户可能刚装完语音引擎） */
    private synchronized void retryIfNeeded() {
        if (!unavailable || engineReady) return;
        if (System.currentTimeMillis() - lastInitTry < 5000) return;
        try {
            if (tts != null) tts.shutdown();
        } catch (Throwable ignored) {}
        tts = null;
        init();
    }

    private static boolean ok(int r) {
        return r != TextToSpeech.LANG_MISSING_DATA && r != TextToSpeech.LANG_NOT_SUPPORTED;
    }

    /** 决定用哪个语言发音，把结论和原因记下来 */
    private void pickLanguage() {
        note = "";
        try {
            if (tts != null) engine = String.valueOf(tts.getDefaultEngine());
        } catch (Throwable ignored) {}
        if ("system".equals(mode)) {
            try {
                Locale d = tts.getDefaultLanguage();
                if (d != null && ok(tts.setLanguage(d))) {
                    langTag = d.toString();
                    note = "使用系统默认语言";
                    return;
                }
            } catch (Throwable ignored) {}
            // 系统默认语言也用不了：继续往下走英语那条路
        }
        Locale[] tries = new Locale[] { Locale.US, Locale.ENGLISH };
        for (Locale l : tries) {
            try {
                int r = tts.setLanguage(l);
                if (ok(r)) {
                    langTag = l.toString();
                    return;
                }
                note = "setLanguage(" + l + ") = " + r;
            } catch (Throwable t) {
                note = "setLanguage 异常: " + t;
            }
        }
        // 英语语音没装：退回引擎默认语言，至少能出声
        try {
            Locale d = tts.getDefaultLanguage();
            if (d != null && ok(tts.setLanguage(d))) {
                langTag = d.toString();
                note = "英语语音未安装，已退回系统默认语言（发音可能不标准）";
                return;
            }
        } catch (Throwable ignored) {}
        langTag = "";
        note = "英语语音未安装，系统默认语言也不可用。请到系统语音设置里安装英语语音";
    }

    public synchronized boolean available() {
        return !unavailable && tts != null;
    }

    public synchronized String mode() {
        return mode;
    }

    public synchronized void setMode(String m) {
        String next = "system".equals(m) ? "system" : "auto";
        if (next.equals(mode)) return;
        mode = next;
        if (engineReady) pickLanguage();
    }

    /** 一句话说清当前状态，给 JS 诊断面板用 */
    public String info() {
        JSONObject o = new JSONObject();
        try {
            o.put("available", available());
            o.put("engineReady", engineReady);
            o.put("unavailable", unavailable);
            o.put("mode", mode);
            o.put("engine", engine);
            o.put("language", langTag);
            o.put("note", note);
        } catch (Throwable ignored) {}
        try {
            Set<Locale> langs = tts == null ? null : tts.getAvailableLanguages();
            JSONArray a = new JSONArray();
            int n = 0;
            if (langs != null) {
                for (Locale l : langs) {
                    if (n++ >= 12) break;
                    a.put(l.toString());
                }
            }
            o.put("languageCount", langs == null ? 0 : langs.size());
            o.put("languages", a);
        } catch (Throwable ignored) {}
        return o.toString();
    }

    public synchronized void speak(String text, float rate) {
        if (text == null) return;
        String s = text.trim();
        if (s.isEmpty()) return;
        if (s.length() > 600) s = s.substring(0, 600);
        retryIfNeeded();
        if (!ready(tts)) {
            // 引擎还没初始化完：先记住这句话，等回调成功再补发。
            // 只有「连引擎对象都没有」才真的放弃。
            if (tts == null && unavailable) return;
            pending = s;
            pendingRate = rate;
            return;
        }
        try {
            tts.setSpeechRate(rate <= 0 ? 1f : rate);
        } catch (Throwable ignored) {}
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                tts.speak(s, TextToSpeech.QUEUE_FLUSH, null, "wp");
            } else {
                tts.speak(s, TextToSpeech.QUEUE_FLUSH, null);
            }
        } catch (Throwable ignored) {}
    }

    private boolean ready(TextToSpeech t) {
        return engineReady && t != null;
    }

    /** 打开系统「文字转语音」设置：用户可以在那里装/换英语语音 */
    public void openSettings() {
        try {
            Intent i = new Intent("com.android.settings.TTS_SETTINGS");
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            return;
        } catch (Throwable ignored) {}
        try {
            Intent i = new Intent(TextToSpeech.Engine.ACTION_CHECK_TTS_DATA);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
        } catch (Throwable t) {
            try {
                Intent i = new Intent(android.provider.Settings.ACTION_SETTINGS);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(i);
            } catch (Throwable ignored) {}
        }
    }

    public synchronized void stop() {
        try {
            if (tts != null) tts.stop();
        } catch (Throwable ignored) {}
    }

    public synchronized void shutdown() {
        try {
            if (tts != null) {
                tts.stop();
                tts.shutdown();
            }
        } catch (Throwable ignored) {}
        tts = null;
        engineReady = false;
    }
}
