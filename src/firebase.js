import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getFunctions } from 'firebase/functions';

// -------------------------------------------------------------
// 🔥 FIREBASE CONFIGURATION
// -------------------------------------------------------------
// IMPORTANT: Paste your Firebase config object here 
// exactly as it copied from the Firebase Console (Step 4 of the guide)
// -------------------------------------------------------------

const firebaseConfig = {
  apiKey: "AIzaSyAjfFwhOdXoY1Z_eI_hkiMghDQlXQn8AD4",
  authDomain: "budgettrackerdb-3ae11.firebaseapp.com",
  projectId: "budgettrackerdb-3ae11",
  storageBucket: "budgettrackerdb-3ae11.firebasestorage.app",
  messagingSenderId: "421318410787",
  appId: "1:421318410787:web:75669a06b4ef87b1c8a796"
};

let app, db, auth, functions = null;

try {
  // We now have real keys, so initialize immediately
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
  functions = getFunctions(app);
} catch (error) {
  console.error("Firebase Initialization Error:", error);
}

export { db, auth, functions };
