self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());
self.addEventListener('fetch', e => {
  // アプリ本体(HTML)は毎回サーバーに最新か確認する（デプロイ後に古い画面が残るのを防ぐ）
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request, { cache: 'no-cache' }).catch(() => fetch(e.request)));
  } else {
    e.respondWith(fetch(e.request));
  }
});
