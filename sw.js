const CACHE = "jiroku-v8";

// タイマー終了などをバックグラウンドでも通知するためのFirebase Cloud Messaging。
// 別ファイル（firebase-messaging-sw.js）として登録すると、同じスコープ('/')の
// Service Workerはどちらか一方しか制御できず、このキャッシュ用sw.jsが上書きされて
// オフライン起動・高速表示が壊れてしまうため、同じsw.js内にまとめて登録する
// Firebase SDKの読み込みに失敗しても（オフライン・CDN障害等）、下のキャッシュ機能
// だけは生き残るようtry/catchで囲む。ここで例外が漏れるとService Worker自体が
// 起動できず、オフライン起動・高速表示まで壊れてしまう
try {
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
    // サーバーはdata-onlyメッセージで送ってくる（notificationフィールド付きだと
    // FCM SDKの自動表示とここでの自前表示が重複し、同じ通知が2連続で届くため）。
    // 移行期の旧形式（notification付き）にも念のためフォールバック対応
    const title = (payload.data && payload.data.title) || (payload.notification && payload.notification.title) || "JIROKU";
    const body = (payload.data && payload.data.body) || (payload.notification && payload.notification.body) || "";
    // 独自にshowNotificationを呼ぶ場合、FCMのwebpush.fcm_options.linkによる
    // 標準クリック挙動は効かないため、リンク先をdataとして持たせて
    // notificationclickハンドラで自前で開く
    const link = (payload.data && payload.data.link) || (payload.fcmOptions && payload.fcmOptions.link) || "/";
    // 同じ内容の通知が二重に届いても1件に集約されるよう、タイトル＋本文から作った
    // 固定tagを指定する。以前はmessageIdを優先していたが、サーバー側から2回送られた
    // 場合はメッセージIDが別になり集約されなかったため、内容ベースに変更した。
    // 同じtagのshowNotificationは追加ではなく置き換えになるため、重複表示を防げる
    const tag = "jiroku|" + title + "|" + body;
    self.registration.showNotification(title, { body, icon: "icon-192.png", badge: "icon-192.png", data: { url: link }, tag });
  });
} catch (e) { /* FCMなしでもキャッシュ機能は動かす */ }

// プッシュ通知タップ時: 既に開いているタブがあればフォーカス、なければ新規に開く
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
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
