import { initializeApp } from 'firebase/app';
import { getFirestore, doc, onSnapshot, setDoc, deleteDoc, collection, addDoc, query, orderBy, getDocs, writeBatch } from 'firebase/firestore';

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

export const clearAllAttendanceLogs = async () => {
  try {
    const querySnapshot = await getDocs(collection(db, 'attendance_logs'));
    const batch = writeBatch(db);
    querySnapshot.forEach((docSnap) => {
      batch.delete(docSnap.ref);
    });
    await batch.commit();
    localStorage.removeItem('uams_attendance_logs');
  } catch (err) {
    console.warn('Firebase clear logs status:', err);
    localStorage.removeItem('uams_attendance_logs');
  }
};

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

    // Firebase Firestore Realtime Listener for Active Sessions (Multi-session support)
    try {
      onSnapshot(doc(db, 'sessions', 'active_sessions'), 
        (docSnap) => {
          if (docSnap.exists()) {
            const data = docSnap.data();
            const sessionsList = data.sessions || [];
            if (onMessage) {
              onMessage({ type: 'SESSIONS_UPDATE', payload: sessionsList });
            }
          } else {
            if (onMessage) {
              onMessage({ type: 'SESSIONS_UPDATE', payload: [] });
            }
          }
        },
        (error) => {
          console.warn('Firebase sessions listener error:', error);
          if (onMessage) {
            onMessage({ type: 'FIREBASE_ERROR', payload: error.message });
          }
        }
      );

      // Firebase Firestore Realtime Listener for Attendance Scans
      const q = query(collection(db, 'attendance_logs'), orderBy('timestamp', 'desc'));
      onSnapshot(q, 
        (snapshot) => {
          snapshot.docChanges().forEach((change) => {
            if (change.type === 'added') {
              const scanData = change.doc.data();
              if (onMessage) {
                onMessage({ type: 'STUDENT_SCAN', payload: scanData });
              }
            }
          });
        },
        (error) => {
          console.warn('Firebase logs listener error:', error);
          if (onMessage) {
            onMessage({ type: 'FIREBASE_ERROR', payload: error.message });
          }
        }
      );
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
    if (type === 'SESSIONS_UPDATE') {
      await setDoc(doc(db, 'sessions', 'active_sessions'), { sessions: payload });
    } else if (type === 'STUDENT_SCAN') {
      await addDoc(collection(db, 'attendance_logs'), payload);
    }
  } catch (err) {
    console.warn('Firebase Cloud sync status:', err);
    if (channel) {
      channel.postMessage({ type: 'FIREBASE_ERROR', payload: err.message });
    }
    throw err;
  }
};

// LocalStorage helpers for active sessions persistence
export const saveActiveSessions = (sessions) => {
  localStorage.setItem('uams_active_sessions', JSON.stringify(sessions));
};

export const getActiveSessions = () => {
  const sessions = localStorage.getItem('uams_active_sessions');
  if (sessions) {
    try {
      return JSON.parse(sessions);
    } catch (e) {
      return [];
    }
  }
  // Legacy fallback
  const oldSession = localStorage.getItem('uams_active_session');
  if (oldSession) {
    try {
      const parsed = JSON.parse(oldSession);
      if (parsed && parsed.sessionActive) {
        return [parsed];
      }
    } catch (e) {}
  }
  return [];
};

export const clearActiveSessions = () => {
  localStorage.removeItem('uams_active_sessions');
  localStorage.removeItem('uams_active_session');
};

export const saveAttendanceLogs = (logs) => {
  localStorage.setItem('uams_attendance_logs', JSON.stringify(logs));
};

export const getAttendanceLogs = () => {
  const logs = localStorage.getItem('uams_attendance_logs');
  return logs ? JSON.parse(logs) : [];
};

