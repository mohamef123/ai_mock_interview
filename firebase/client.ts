import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyAQO9TYHx9KszfPhtabOrKA9zxJGEoFwKw",
  authDomain: "prepwise-ff600.firebaseapp.com",
  projectId: "prepwise-ff600",
  storageBucket: "prepwise-ff600.firebasestorage.app",
  messagingSenderId: "631039898098",
  appId: "1:631039898098:web:1da13aefe61561f6bafb6b",
  measurementId: "G-HWDBC7P4PW"
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);
export const db = getFirestore(app);