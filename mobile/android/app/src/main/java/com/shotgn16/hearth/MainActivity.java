package com.shotgn16.hearth;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/**
 * The Hearth phone app. It shows your own Hearth server in the app's window.
 *
 * When a hearth://connect?url=… link opens the app (the QR code on Hearth's Phones & devices screen), the app's
 * connect screen takes over — even if another Hearth is showing — and connects to that address.
 */
public class MainActivity extends BridgeActivity {
    private static final String CONNECT_PAGE = "http://localhost/index.html?connect=";

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String address = connectAddress(intent);
        if (address != null && getBridge() != null) {
            getBridge().getWebView().post(() -> getBridge().getWebView().loadUrl(CONNECT_PAGE + Uri.encode(address)));
        }
    }

    /** The url=… of a hearth://connect link, or null */
    static String connectAddress(Intent intent) {
        if (intent == null || intent.getData() == null) return null;
        Uri data = intent.getData();
        if (!"hearth".equals(data.getScheme()) || !"connect".equals(data.getHost())) return null;
        String url = data.getQueryParameter("url");
        return url != null && (url.startsWith("http://") || url.startsWith("https://")) ? url : null;
    }
}
