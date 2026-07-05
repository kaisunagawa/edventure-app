const CACHE = "jiroku-v3";

// タイマー終了などをバックグラウンドでも通知するためのFirebase Cloud Messaging。
// 別ファイル（firebase-messaging-sw.js）として登録すると、同じスコープ('/')の
// Service Workerはどちらか一方しか制御できず、このキャッシュ用sw.jsが上書きされて
// オフライン起動・高速表示が壊れてしまうため、同じsw.js内にまとめて登録する
importScripts("https://www.gstatic.com/firebasejs/12.15.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.15.0/firebase-messaging-compat.js");
firebase.initializeApp({
  apiKey: "AIzaSyCfOKqEbdGBIHA0s_CQAYvr0oViRaK9uE4",
  authDomain: "jiroku-77bbf.firebaseapp.com",
  projectId: "jiroku-77bbf",
  storageBucket: "jiroku-77bbf.firebasestorage.app",
  messagingSenderId: "156734910749",
  appId: "1:156734910749:web:5a16619bbde59718d2b1f4"
});
const messaging = firebase.messaging();
messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || "JIROKU";
  const body = (payload.notification && payload.notification.body) || "";
  self.registration.showNotification(title, { body, icon: "icon-192.png", badge: "icon-192.png" });
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// タイムアウト付きfetch（遅い回線でいつまでも白画面にならないように）
function fetchWithTimeout(req, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(req).then(res => { clearTimeout(timer); resolve(res); }, err => { clearTimeout(timer); reject(err); });
  });
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // アプリ本体(HTML): ネットワーク優先（2.5秒でキャッシュにフォールバック）。
  // デプロイ直後は最新が表示され、回線が遅い時はキャッシュで即起動する
  if (e.request.mode === 'navigate') {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetchWithTimeout(e.request, 2500);
        if (res.ok) cache.put('app-shell', res.clone());
        return res;
      } catch {
        const cached = await cache.match('app-shell');
        if (cached) return cached;
        return fetch(e.request);
      }
    })());
    return;
  }

  // CDNの静的アセット(React・フォント等): キャッシュ優先。
  // 毎回の再取得が起動を遅くしていた最大の要因のため、初回以降はキャッシュから即返す
  if (/(^|\.)unpkg\.com$|(^|\.)fonts\.googleapis\.com$|(^|\.)fonts\.gstatic\.com$|^www\.gstatic\.com$/.test(url.host)) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok || res.type === 'opaque') cache.put(e.request, res.clone());
      return res;
    })());
    return;
  }

  // それ以外(GAS APIや認証など)はキャッシュせず素通し
  e.respondWith(fetch(e.request));
});
