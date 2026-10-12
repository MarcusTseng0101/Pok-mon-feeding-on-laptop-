package dev.kalos.journey;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Collections;

// 卡洛斯旅行的外殼：一個全螢幕的 WebView，遊戲本體是 assets/www 裡的網頁（src/journey、src/core）。
// - 網頁用 https://appassets.androidplatform.net/ 這個假網址從 assets 讀（file:// 不能用 ES module）
// - 只開自己的檔案：別的網址一律不跳過去；圖片例外（PokeAPI 的寶可夢圖，網頁的 CSP 只准這一個）
// - KalosNative：steps()＝計步器開機以來的總步數（沒有計步器或沒給權限是 -1）、save／load＝存檔備份到 app 自己的資料夾
public class MainActivity extends Activity implements SensorEventListener {
    static final String HOST = "appassets.androidplatform.net";
    static final int ASK_STEPS = 1;

    private WebView web;
    private SensorManager sensors;
    private volatile double steps = -1;
    private boolean announced = false;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true); // 測試：電腦上用 Chrome 遠端偵錯點畫面
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        web.addJavascriptInterface(new Bridge(), "KalosNative");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (!HOST.equals(u.getHost())) return null; // 圖片照常從網路抓（WebView 自己會快取）
                String path = u.getPath() == null ? "" : u.getPath().replaceFirst("^/", "");
                if (path.contains("..")) return notFound();
                try {
                    InputStream in = getAssets().open("www/" + path);
                    return new WebResourceResponse(mime(path), "utf-8", in);
                } catch (IOException e) {
                    return notFound();
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                return !HOST.equals(req.getUrl().getHost()); // 不離開遊戲
            }
        });
        setContentView(web);
        web.loadUrl("https://" + HOST + "/src/journey/index.html");

        sensors = (SensorManager) getSystemService(SENSOR_SERVICE);
        if (Build.VERSION.SDK_INT >= 29 && checkSelfPermission(Manifest.permission.ACTIVITY_RECOGNITION) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] { Manifest.permission.ACTIVITY_RECOGNITION }, ASK_STEPS);
        }
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }

    private static String mime(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js") || path.endsWith(".mjs")) return "text/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".json")) return "application/json";
        if (path.endsWith(".woff2")) return "font/woff2";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".svg")) return "image/svg+xml";
        return "application/octet-stream";
    }

    private void listenSteps() {
        if (sensors == null) return;
        if (Build.VERSION.SDK_INT >= 29 && checkSelfPermission(Manifest.permission.ACTIVITY_RECOGNITION) != PackageManager.PERMISSION_GRANTED) return;
        Sensor counter = sensors.getDefaultSensor(Sensor.TYPE_STEP_COUNTER);
        if (counter != null) sensors.registerListener(this, counter, SensorManager.SENSOR_DELAY_NORMAL);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (code == ASK_STEPS) listenSteps();
    }

    @Override
    protected void onResume() {
        super.onResume();
        announced = false;
        listenSteps();
    }

    @Override
    protected void onPause() {
        if (sensors != null) sensors.unregisterListener(this);
        super.onPause();
    }

    @Override
    public void onSensorChanged(SensorEvent e) {
        steps = e.values[0];
        // 計步器打開後第一次回報：跟網頁說一聲（網頁一開始讀的時候可能還沒有數字）
        if (!announced) {
            announced = true;
            web.evaluateJavascript("window.__kalosSteps && window.__kalosSteps()", null);
        }
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) { }

    @Override
    public void onBackPressed() {
        moveTaskToBack(true); // 返回鍵＝回到桌面（遊戲留在原地），不會誤關
    }

    class Bridge {
        @JavascriptInterface
        public double steps() { return steps; }

        // 存檔備份：先寫暫存檔再改名，寫到一半被關掉也不會壞
        @JavascriptInterface
        public void save(String json) {
            if (json == null || json.length() > 2_000_000) return;
            File out = new File(getFilesDir(), "journey.json");
            File tmp = new File(getFilesDir(), "journey.json.tmp");
            try (FileOutputStream f = new FileOutputStream(tmp)) {
                f.write(json.getBytes(StandardCharsets.UTF_8));
                f.getFD().sync();
            } catch (IOException e) {
                return;
            }
            if (!tmp.renameTo(out)) tmp.delete();
        }

        @JavascriptInterface
        public String load() {
            File f = new File(getFilesDir(), "journey.json");
            try {
                return f.exists() ? new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8) : "";
            } catch (IOException e) {
                return "";
            }
        }
    }
}
