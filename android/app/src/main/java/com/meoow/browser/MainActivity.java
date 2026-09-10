package com.meoow.browser;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.Toast;

import org.json.JSONObject;

public class MainActivity extends Activity {

    private static final String START = "file:///android_asset/meoow/index.html";
    private static final String PREFS = "meoow";

    private WebView web;
    private EditText urlBar;
    private Button backBtn, fwdBtn;
    private FrameLayout webHost;
    private SharedPreferences prefs;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        buildUi();

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setLoadsImagesAutomatically(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " Meoow/1.0.5");
        resetBridge();
        web.setWebViewClient(new MeoowClient());
        web.setWebChromeClient(new WebChromeClient());
        web.setBackgroundColor(0xFFFFF7ED);
        webHost.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(android.content.Intent intent) {
        if (intent != null && intent.getData() != null) {
            web.loadUrl(intent.getData().toString());
        } else {
            web.loadUrl(START);
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void resetBridge() {
        web.addJavascriptInterface(new Bridge(), "MeoowNative");
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(6), dp(5), dp(6), dp(5));
        bar.setBackgroundColor(0xFFF6EEE0);
        root.addView(bar, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        backBtn = navButton("‹", v -> { if (web.canGoBack()) web.goBack(); });
        fwdBtn = navButton("›", v -> { if (web.canGoForward()) web.goForward(); });
        bar.addView(backBtn);
        bar.addView(fwdBtn);
        bar.addView(navButton("↻", v -> web.reload()));

        urlBar = new EditText(this);
        urlBar.setSingleLine(true);
        urlBar.setTextSize(15);
        urlBar.setTextColor(0xFF3B2618);
        urlBar.setHint("Адрес или запрос");
        urlBar.setHintTextColor(0xFF9A8570);
        urlBar.setImeOptions(EditorInfo.IME_ACTION_GO);
        urlBar.setOnEditorActionListener((v, actionId, ev) -> {
            if (actionId == EditorInfo.IME_ACTION_GO) { go(urlBar.getText().toString()); return true; }
            return false;
        });
        LinearLayout.LayoutParams urlLp = new LinearLayout.LayoutParams(0,
                ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        bar.addView(urlBar, urlLp);
        bar.addView(navButton("⌂", v -> web.loadUrl(START)));

        webHost = new FrameLayout(this);
        root.addView(webHost, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        setContentView(root);
    }

    private Button navButton(String glyph, View.OnClickListener on) {
        Button bt = new Button(this);
        bt.setText(glyph);
        bt.setTextSize(20);
        bt.setTextColor(0xFFC7410F);
        bt.setBackgroundColor(0x00000000);
        bt.setMinWidth(0);
        bt.setMinimumWidth(dp(44));
        bt.setAllCaps(false);
        bt.setOnClickListener(on);
        return bt;
    }

    private int dp(int v) {
        return Math.round(getResources().getDisplayMetrics().density * v);
    }

    private void go(String raw) {
        if (raw == null) return;
        String t = raw.trim();
        if (t.isEmpty()) return;
        if (t.contains(" ") || !t.matches("(?i)https?://.*")) {
            web.loadUrl(START);
            afterLoad(() -> web.loadUrl("javascript:(function(){ location.hash='q=' + " +
                    "encodeURIComponent(" + jsStr(t) + "); })();"));
        } else {
            String url = t.matches("(?i)https?://.*") ? t : "https://" + t;
            web.loadUrl(url);
        }
    }

    private String jsStr(String s) {
        return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'";
    }

    private void afterLoad(Runnable r) {
        web.postDelayed(r, 350);
    }

    private boolean isHome(String url) {
        return url == null || url.startsWith("file:///android_asset/meoow/");
    }

    private void updateNav(String url) {
        if (urlBar == null) return;
        if (!isHome(url)) urlBar.setText(humanUrl(url));
        else urlBar.setText("");
        backBtn.setEnabled(web != null && web.canGoBack());
        fwdBtn.setEnabled(web != null && web.canGoForward());
    }

    private String humanUrl(String url) {
        return url.replaceFirst("^https?://", "").replaceFirst("/?$", "");
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && event.getRepeatCount() == 0) {
            if (web != null && web.canGoBack()) { web.goBack(); return true; }
            if (web != null && web.getUrl() != null && !isHome(web.getUrl())) { web.loadUrl(START); return true; }
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }

    private class MeoowClient extends WebViewClient {
        @Override
        public void onPageStarted(WebView v, String url, Bitmap fav) {
            updateNav(url);
        }

        @Override
        public void onPageFinished(WebView v, String url) {
            updateNav(url);
            if (web != null) {
                try { web.evaluateJavascript(
                        "window.meoowStart && window.meoowStart();", null); } catch (Throwable ignored) {}
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return false;
        }
    }

    @SuppressWarnings("unused")
    private class Bridge {
        @JavascriptInterface
        public String loadData() {
            try {
                JSONObject o = new JSONObject();
                o.put("serverUrl", prefs.getString("serverUrl", "http://10.0.2.2:18700"));
                o.put("history", prefs.getString("history", "[]"));
                o.put("bookmarks", prefs.getString("bookmarks", "[]"));
                o.put("version", "1.0.5");
                return o.toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        @JavascriptInterface
        public void saveData(String json) {
            try {
                JSONObject o = new JSONObject(json);
                prefs.edit()
                        .putString("serverUrl", o.optString("serverUrl", prefs.getString("serverUrl", "http://10.0.2.2:18700")))
                        .putString("history", o.optString("history", "[]"))
                        .putString("bookmarks", o.optString("bookmarks", "[]"))
                        .apply();
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public void toast(String msg) {
            try { Toast.makeText(MainActivity.this, String.valueOf(msg), Toast.LENGTH_SHORT).show(); } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public String version() {
            return "1.0.5";
        }
    }
}