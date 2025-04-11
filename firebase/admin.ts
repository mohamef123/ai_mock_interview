import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

// Mock implementations for Firebase services when real ones aren't available
class MockAuth {
  async getUserByEmail() { return { uid: 'mock-uid', email: 'mock@example.com' }; }
  async verifyIdToken() { return { uid: 'mock-uid', email: 'mock@example.com' }; }
  async createCustomToken() { return 'mock-custom-token'; }
  async createSessionCookie() { return 'mock-session-cookie'; }
  async verifySessionCookie() { return { uid: 'mock-uid', email: 'mock@example.com' }; }
}

class MockFirestore {
  collection() { return this; }
  doc() { return this; }
  where() { return this; }
  orderBy() { return this; }
  limit() { return this; }
  async get() { return { docs: [], empty: true }; }
  async set() { return {}; }
  async update() { return {}; }
  async delete() { return {}; }
  async add() { return { id: 'mock-id' }; }
}

// Initialize Firebase Admin SDK
function initFirebaseAdmin() {
  const apps = getApps();

  console.log("Initializing Firebase Admin, existing apps:", apps.length);

  // Check if all required environment variables are present
  const hasCredentials = !!(process.env.FIREBASE_PROJECT_ID && 
                           process.env.FIREBASE_CLIENT_EMAIL && 
                           process.env.FIREBASE_PRIVATE_KEY);

  if (!apps.length) {
    if (!hasCredentials) {
      console.error("Firebase credentials are missing:", {
        projectId: !!process.env.FIREBASE_PROJECT_ID,
        clientEmail: !!process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: !!process.env.FIREBASE_PRIVATE_KEY,
        projectIdValue: process.env.FIREBASE_PROJECT_ID,
        clientEmailValue: process.env.FIREBASE_CLIENT_EMAIL,
        privateKeyLength: process.env.FIREBASE_PRIVATE_KEY?.length
      });
      
      // Initialize with empty app during build if credentials are missing
      // This prevents build errors but won't allow actual Firebase operations
      console.log("Using fallback initialization due to missing credentials");
      initializeApp();
      return {
        auth: new MockAuth() as any,
        db: new MockFirestore() as any,
        usingMock: true
      };
    } else {
      // Initialize with proper credentials when available
      try {
        const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
        console.log("Initializing Firebase Admin with:", {
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          hasPrivateKey: !!privateKey,
          privateKeyLength: privateKey?.length
        });
        
        initializeApp({
          credential: cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: privateKey,
          }),
        });
        console.log("Firebase Admin initialized successfully");
      } catch (error) {
        console.error("Error initializing Firebase Admin:", error);
        console.log("Using fallback initialization due to initialization error");
        // Initialize with empty app as fallback
        initializeApp();
        return {
          auth: new MockAuth() as any,
          db: new MockFirestore() as any,
          usingMock: true
        };
      }
    }
  }

  try {
    const auth = getAuth();
    const db = getFirestore();
    console.log("Firebase Admin services initialized");
    return { auth, db, usingMock: false };
  } catch (error) {
    console.error("Error getting Firebase Admin services:", error);
    console.log("Using mock services due to service initialization error");
    return {
      auth: new MockAuth() as any,
      db: new MockFirestore() as any,
      usingMock: true
    };
  }
}

console.log("Starting Firebase Admin initialization...");
export const { auth, db, usingMock } = initFirebaseAdmin();
console.log("Firebase Admin initialization complete, using mock:", usingMock);