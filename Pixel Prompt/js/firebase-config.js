// js/firebase-config.js
(function () {
  'use strict';

  // IMPORTANT:
  // Use the config shown in your Firebase Console. This file simply sets window.firebaseConfig
  // so other scripts (script.js, admin.js) can initialize using the compat SDKs already loaded.

  if (window.firebaseConfig && Object.keys(window.firebaseConfig).length) {
    console.info('window.firebaseConfig already defined (using existing value).');
    return;
  }

  // ---- Paste your Firebase config below (confirm values in Firebase console) ----
  window.firebaseConfig = {
    apiKey: "AIzaSyBUlUUv-Fk-lI7vowxJMb5GbmPcK7dDIrY",
    authDomain: "pixelprompt-dca72.firebaseapp.com",
    projectId: "pixelprompt-dca72",
    storageBucket: "pixelprompt-dca72.firebasestorage.app",
    messagingSenderId: "954860926035",
    appId: "1:954860926035:web:8002867101ed26c94cc2a6"
  };
  // --------------------------------------------------------------------------------

  console.info('window.firebaseConfig set from js/firebase-config.js for project:', window.firebaseConfig.projectId);

  (function validate(cfg) {
    const required = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'appId'];
    const missing = required.filter(k => !cfg[k]);
    if (missing.length) {
      console.warn('firebase-config.js: missing config keys:', missing.join(', '));
    } else {
      console.info('firebase-config.js: config looks OK for project:', cfg.projectId);
    }
  })(window.firebaseConfig || {});

  // Do NOT auto-initialize here; script.js will initialize Firebase (compat) when it runs.
})();