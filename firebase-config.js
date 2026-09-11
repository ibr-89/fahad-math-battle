export const firebaseConfig = {
  apiKey: "AIzaSyAYXepGI-_er3s8XyPsFFyuOuwvW05ZPX4",
  authDomain: "fahad-math-battle.firebaseapp.com",
  databaseURL: "https://fahad-math-battle-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "fahad-math-battle",
  storageBucket: "fahad-math-battle.firebasestorage.app",
  messagingSenderId: "208111433981",
  appId: "1:208111433981:web:e5dc5098bc219081812694"
};

// Load the family-tested v9.7 logic patch without changing the stable v9.6 app bundle.
if (typeof window !== "undefined") {
  import("./logic-fixes-v9.7.js?v=9.7").catch(err => console.error("v9.7 logic patch failed to load", err));
}
