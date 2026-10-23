/* ====== EDIT THIS FILE ======
   Leave `firebase: null` to run in DEMO MODE (data stays in your own browser only;
   the demo edit code is "demo123").
   Paste your Firebase web config (see README step 2) to go live. */
window.VB_CONFIG = {
  siteTitle: 'Duke Club Volleyball',

  // The scorekeeper login you create in Firebase Authentication.
  // Its PASSWORD is the edit code you hand out. Must match firestore.rules.
  scorekeeperEmail: 'scorekeeper@dukeclubvb.app',

  // How often spectators' screens refresh, in seconds. Polling keeps you well inside
  // Firebase's free tier. Set to 0 for instant updates (uses far more of the free quota).
  viewerRefreshSeconds: 20,

  firebase: null,
  /* Example — replace with yours:
  firebase: {
    apiKey: "AIza...",
    authDomain: "your-project.firebaseapp.com",
    projectId: "your-project",
    storageBucket: "your-project.appspot.com",
    messagingSenderId: "1234567890",
    appId: "1:1234567890:web:abc123"
  },
  */
};
