import { initializeApp } from 'firebase/app';
import { getFirestore, doc, onSnapshot, setDoc, deleteDoc, collection, addDoc, query, orderBy } from 'firebase/firestore';

// User's Firebase Project Configuration (attend-lec-9de44)
const firebaseConfig = {
  apiKey: "AIzaSyAq_yMDewlZX8jRVsyWiwjdl7lnW8DoW4M",
  authDomain: "attend-lec-9de44.firebaseapp.com",
  projectId: "attend-lec-9de44",
  storageBucket: "attend-lec-9de44.firebasestorage.app",
  messagingSenderId: "1048104611016",
  appId: "1:1048104611016:web:ea126bbdac1138d49b89fd",
  measurementId: "G-JDDLBLJ1SM"
};

// Initialize Firebase & Firestore
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// Shared state management using BroadcastChannel + Firebase Firestore Sync
const CHANNEL_NAME = 'uams-realtime-channel';

export const createBroadcastChannel = (onMessage) => {
  if (typeof window === 'undefined') return null;

  try {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (event) => {
      if (onMessage) {
        onMessage(event.data);
      }
    };

    // Firebase Firestore Realtime Listener for Active Sessions
    try {
      onSnapshot(doc(db, 'sessions', 'active_session'), (docSnap) => {
        if (docSnap.exists()) {
          const sessionData = docSnap.data();
          if (onMessage) {
            onMessage({ type: 'SESSION_UPDATE', payload: sessionData });
          }
        } else {
          if (onMessage) {
            onMessage({ type: 'SESSION_UPDATE', payload: { sessionActive: false } });
          }
        }
      });

      // Firebase Firestore Realtime Listener for Attendance Scans
      const q = query(collection(db, 'attendance_logs'), orderBy('timestamp', 'desc'));
      onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'added') {
            const scanData = change.doc.data();
            if (onMessage) {
              onMessage({ type: 'STUDENT_SCAN', payload: scanData });
            }
          }
        });
      });
    } catch (firebaseErr) {
      console.warn('Firebase realtime listener fallback:', firebaseErr);
    }

    return channel;
  } catch (e) {
    console.error('BroadcastChannel is not supported in this browser.', e);
    return null;
  }
};

export const postChannelMessage = async (channel, type, payload) => {
  // Broadcast locally for instant response
  if (channel) {
    channel.postMessage({ type, payload });
  }

  // Sync to Firebase Cloud Firestore for real devices online
  try {
    if (type === 'SESSION_UPDATE') {
      if (payload.sessionActive) {
        await setDoc(doc(db, 'sessions', 'active_session'), payload);
      } else {
        await deleteDoc(doc(db, 'sessions', 'active_session'));
      }
    } else if (type === 'STUDENT_SCAN') {
      await addDoc(collection(db, 'attendance_logs'), payload);
    }
  } catch (err) {
    console.warn('Firebase Cloud sync status:', err);
  }
};

// LocalStorage helpers for session persistence
export const saveActiveSession = (session) => {
  localStorage.setItem('uams_active_session', JSON.stringify(session));
};

export const getActiveSession = () => {
  const session = localStorage.getItem('uams_active_session');
  return session ? JSON.parse(session) : null;
};

export const clearActiveSession = () => {
  localStorage.removeItem('uams_active_session');
};

export const saveAttendanceLogs = (logs) => {
  localStorage.setItem('uams_attendance_logs', JSON.stringify(logs));
};

export const getAttendanceLogs = () => {
  const logs = localStorage.getItem('uams_attendance_logs');
  return logs ? JSON.parse(logs) : [];
};
