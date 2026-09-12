export const firebaseConfig = {
  apiKey: "AIzaSyAYXepGI-_er3s8XyPsFFyuOuwvW05ZPX4",
  authDomain: "fahad-math-battle.firebaseapp.com",
  databaseURL: "https://fahad-math-battle-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "fahad-math-battle",
  storageBucket: "fahad-math-battle.firebasestorage.app",
  messagingSenderId: "208111433981",
  appId: "1:208111433981:web:e5dc5098bc219081812694"
};

// v9.7: family-tested question logic and answer reveal.
// v9.8: optional playing host + two-competitor minimum.
if (typeof window !== "undefined") {
  import("./logic-fixes-v9.7.js?v=9.7")
    .then(() => import("./host-player-v9.8.js?v=9.8"))
    .catch(err => console.error("Math Race logic patches failed to load", err));
}
