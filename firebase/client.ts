// Import the functions you need from the SDKs you need
import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, Auth } from "firebase/auth";
import { getFirestore, Firestore } from "firebase/firestore";
// Dynamically import analytics to avoid SSR issues
import { Analytics, getAnalytics } from "firebase/analytics";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "AIzaSyCjra5dwOtJAYLjlJBlTXNE2uWjxNC1kDk",
  authDomain: "prewise-6f44b.firebaseapp.com",
  projectId: "prewise-6f44b",
  storageBucket: "prewise-6f44b.firebasestorage.app",
  messagingSenderId: "424923985679",
  appId: "1:424923985679:web:67e047a76cbda4f2a9b07a",
  measurementId: "G-LF4L1E9D22"
};

// Log config (without sensitive values) for debugging
console.log('Firebase config:', {
  hasApiKey: !!firebaseConfig.apiKey,
  authDomain: firebaseConfig.authDomain,
  projectId: firebaseConfig.projectId
});

// Initialize Firebase
let app;
try {
  if (!firebaseConfig.apiKey || !firebaseConfig.authDomain || !firebaseConfig.projectId) {
    throw new Error('Missing required Firebase configuration. Check your environment variables.');
  }
  
  app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
  console.log('Firebase initialized successfully');
} catch (error) {
  console.error("Error initializing Firebase:", error);
  console.error("Falling back to mock implementation");
  // Initialize with empty config for development/testing
  app = !getApps().length ? initializeApp({
    apiKey: "mock-api-key",
    authDomain: "mock-auth-domain",
    projectId: "mock-project-id"
  }) : getApp();
}

// Initialize Analytics only on the client side
let analytics: Analytics | undefined;
if (typeof window !== 'undefined') {
  try {
    analytics = getAnalytics(app);
    console.log('Analytics initialized successfully');
  } catch (error) {
    console.error("Error initializing Analytics:", error);
  }
}

// Initialize and export services
let auth: Auth;
let db: Firestore;

try {
  auth = getAuth(app);
  db = getFirestore(app);
  console.log('Auth and Firestore services initialized successfully');
} catch (error) {
  console.error("Error initializing Firebase services:", error);
  throw error; // Re-throw to help identify service initialization issues
}

export { auth, db };