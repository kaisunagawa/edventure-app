// 認証基盤(Auth CP1)の導入にあわせて更新。古いキャッシュは activate 時に削除され、
// skipWaiting + clients.claim で即座に新しい版へ切り替わる。
// index.html はネットワーク優先(2.5秒でキャッシュ)のため、認証前のフロントが
// 残り続けることはない
// ★v10★ 2026-08-01: 通信をPOSTのJSON本文へ統一（URLにトークンを載せない）。
// 古いフロントがキャッシュに残っていると、URLへトークンを載せる旧コードが
// 動き続けてしまう。版を上げて確実に入れ替える。
// ★v13★ 2026-08-05: 裏での取り直しがHTTPキャッシュから古いHTMLを受け取っていた。
//   保存されるキャッシュも古いままになり、何度読み込み直しても新しい版に
//   変わらなくなっていた（Kai報告）。名前を上げて、詰まったキャッシュを捨てる。
// ★v17★ 2026-08-19: 端末を変えた既存ユーザーにチュートリアルが出る不具合を直したのに、
//   古いindex.htmlがキャッシュに残っていて直らなかった（あつこさんのパソコン）。
//   名前を上げると activate で古いキャッシュが消え、skipWaiting で即座に入れ替わる。
//   ★画面側の直しが「届かない」ときは、まずここを疑うこと★
// ★名前を変えると、古い保存画面が全部捨てられる★（2026-08-20 Kai報告
//   「まだキャッシュ残ってるんじゃないの？変わってないよ」）
//   このSWは新しい名前で立ち上がると activate で他の名前を全部消し、
//   すぐ clients.claim() する。保存画面が無くなるので、次に開いたときは
//   必ずネットワークから取り直す。端末で何も操作しなくても入れ替わる。
//   ★中身を変えたのに「古いまま」の報告が出たら、ここを1つ進めること★
const CACHE = "jiroku-20260903-131531";

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
      // ★開いている画面をこちらから開き直す★（2026-08-20 Kai報告
      //   「まだ変わってないよ」）
      //   名前を進めて保存を捨てても、いま開いている画面はもう古いHTMLを
      //   受け取ったあとなので、そのままでは変わらない。結局「もう1回開いて」と
      //   お願いすることになっていた。保存を捨てた直後にこちらから開き直す。
      //   ここを通るのは版を出したときだけなので、普段の操作は邪魔しない。
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(list => list.forEach(c => { try { c.navigate(c.url); } catch (err) {} }))
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

  // 版番号だけの小さなファイル。ここは必ず最新を見る（キャッシュしない）
  if (url.pathname.indexOf('/version.json') !== -1) {
    e.respondWith(fetch(e.request, { cache: 'no-store' }).catch(() => new Response('{}', { headers: { 'Content-Type': 'application/json' } })));
    return;
  }

  // アプリ本体(HTML): キャッシュ優先で即表示し、裏で最新を取り直す
  // （stale-while-revalidate）。
  //
  // ★なぜネットワーク優先をやめたか★（2026-08-05）
  //   以前は毎回ネットワークを最大2.5秒待ってから表示していた。回線が普通に
  //   繋がっている端末ほど「毎回きっちり待たされる」ことになり、起動が重い
  //   最大の原因だった（本体は約180KB）。
  //   新しい版が届かなくなるのでは、という心配は要らない。裏で取り直した結果は
  //   次の起動で使われるうえ、アプリ側が version.json（数十バイト）で版番号を
  //   見張っていて、変わっていればその場で読み込み直す。
  //   つまり「表示は即座・更新は確実」の両方が成り立つ。
  if (e.request.mode === 'navigate') {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      // ★画面ごとに分けて持つ★
      //   以前は本体もコーチ画面も 'app-shell' という同じ名前で1つだけ持っていた。
      //   コーチ画面を開くと本体のキャッシュが置き換わり、通信が遅いときに
      //   別の画面が返って「開かない・回り続ける」ことがあった（2026-08-03）。
      const shellKey = url.pathname.indexOf('/coach') !== -1 ? 'app-shell-coach' : 'app-shell';
      const cached = await cache.match(shellKey);
      // 裏での取り直し。表示を待たせないので、ここではawaitしない
      //   ★cache:'reload' が必須★
      //     GitHub Pages は index.html を max-age=600 で返す。ふつうに fetch すると
      //     10分間はブラウザのHTTPキャッシュから古いHTMLが返り、それをそのまま
      //     保存してしまうため、いつまでも新しい版に入れ替わらない。
      const revalidate = fetch(e.request, { cache: 'reload' })
        .then(res => { if (res.ok) cache.put(shellKey, res.clone()); return res; })
        .catch(() => null);
      if (cached) {
        e.waitUntil(revalidate);   // 応答を返した後もSWを生かして取り直しを完了させる
        return cached;
      }
      // 初回訪問（キャッシュなし）だけはネットワークを待つ
      const res = await revalidate;
      if (res) return res;
      return fetchWithTimeout(e.request, 8000).catch(() => new Response(
        '<meta charset="utf-8"><p style="font-family:sans-serif;padding:24px">通信できませんでした。電波の良い場所でもう一度開いてください。</p>',
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
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

  // 自分のところの画像(階級のキャラクターやアイコン): キャッシュ優先。
  // 中身が変わらないファイルなので、開くたびに取り直す必要がない
  // （階級の絵だけで300KB以上あり、設定を開くたびに落としていた）。
  if (url.origin === self.location.origin && /\.(png|jpe?g|svg|webp|gif)$/i.test(url.pathname)) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(e.request);
      if (hit) return hit;
      try {
        const res = await fetch(e.request);
        if (res.ok) {
          await cache.put(e.request, res.clone());
          // ★古い版を消す★ 画像のURLには ?v=ビルド番号 が付いている。
          //   消さないと、出すたびに前の版が残って端末の中で膨らみ続ける。
          //   同じファイルの、版だけが違うものを片づける。
          const keys = await cache.keys();
          await Promise.all(keys.map(k => {
            const u = new URL(k.url);
            if (u.origin === url.origin && u.pathname === url.pathname && u.search !== url.search) {
              return cache.delete(k);
            }
          }));
        }
        return res;
      } catch (err) {
        return new Response("", { status: 504 });
      }
    })());
    return;
  }

  // それ以外(GAS APIや認証など)はキャッシュせず素通し
  e.respondWith(fetch(e.request));
});
