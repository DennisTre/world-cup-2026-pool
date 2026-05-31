// Firebase Configuration
// Replace these values with your Firebase project config
const firebaseConfig = {
    apiKey: "AIzaSyDCeqwfV6FKNiXrh9oqrkRCa0OnK1oi0as",
    authDomain: "world-cup-2026-pool-970a9.firebaseapp.com",
    projectId: "world-cup-2026-pool-970a9",
    storageBucket: "world-cup-2026-pool-970a9.firebasestorage.app",
    messagingSenderId: "498091458629",
    appId: "1:498091458629:web:c040469d673269c7d9e32c"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
