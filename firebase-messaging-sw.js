// タイマー終了などをアプリを閉じている間・画面ロック中でも通知するための
// Firebase Cloud Messaging用Service Worker。index.html側のFIREBASE_CONFIGと
// 同じ値をここにも書く必要がある（Service Workerは別スコープで動くため共有できない）
importScripts("https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
});

const messaging = firebase.messaging();

// アプリがバックグラウンド（閉じている・裏に回っている）時に届いた通知を表示する
messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || "JIROKU";
  const body = (payload.notification && payload.notification.body) || "";
  self.registration.showNotification(title, {
    body: body,
    icon: "icon-192.png",
    badge: "icon-192.png"
  });
});
