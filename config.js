/* ====== EDIT THIS FILE ======
   Leave `firebase: null` to run in DEMO MODE (data stays in your own browser only;
   the demo edit code is "demo123").
   Paste your Firebase web config (see README step 2) to go live. */
window.VB_CONFIG = {
  siteTitle: 'Duke Club Volleyball',

  // The scorekeeper login you create in Firebase Authentication.
  // Its PASSWORD is the edit code you hand out. Must match firestore.rules.
  scorekeeperEmail: 'scorekeeper@dukeclubvb.app',

  // 0 = spectators' screens update instantly when a final score is saved.
  // Scores are saved once per match, so this stays far inside Firebase's free tier.
  // Set to e.g. 30 to refresh on a timer instead.
  viewerRefreshSeconds: 0,

  firebase: { apiKey: "AIzaSyDa1DLgtEv4D0zjIu18inP_5gWSmNpDMQo", authDomain: "duke-vb-scores.firebaseapp.com", projectId: "duke-vb-scores", storageBucket: "duke-vb-scores.firebasestorage.app", messagingSenderId: "186503845345", appId: "1:186503845345:web:0b3e20d78fdb692065aea0" },
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
