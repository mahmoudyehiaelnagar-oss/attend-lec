import React, { useState, useEffect, useRef } from 'react';
import { Shield, MapPin, Camera, Smartphone, AlertOctagon, CheckCircle2 } from 'lucide-react';
import { createBroadcastChannel, postChannelMessage } from '../utils/sharedState';

const MOCK_STUDENTS = [
  { id: '2024-PHARM-099', name: 'أحمد الغامدي', profile: 'clean', title: 'سليم (مطابقة 100%)' },
  { id: '2024-PHARM-088', name: 'خالد منصور', profile: 'rooted', title: 'جهاز مكسور الحماية (Rooted)' },
  { id: '2024-PHARM-115', name: 'ياسمين ممدوح', profile: 'fake_gps', title: 'موقع وهمي (Fake GPS)' },
  { id: '2024-PHARM-042', name: 'كريم علي', profile: 'liveness_fail', title: 'فشل الفحص الحيوي (Liveness Fail)' }
];

export default function StudentPortal() {
  const [studentId, setStudentId] = useState('');
  const [studentName, setStudentName] = useState('');
  const [studentEmail, setStudentEmail] = useState('');
  const [selectedStudent, setSelectedStudent] = useState(MOCK_STUDENTS[0]);
  const [studentIp, setStudentIp] = useState('');
  const [activeSession, setActiveSession] = useState(null);
  const [scanStep, setScanStep] = useState('idle'); // idle, scanning, integrity, location, fingerprint, liveness, done
  const [logDetails, setLogDetails] = useState('الرجاء تعبئة بيانات الطالب والضغط على زر بدء الفحص وتنسيق جهازك الحصري.');
  const [bypassGps, setBypassGps] = useState(true);
  const [actualCoords, setActualCoords] = useState(null);
  const [profCoords, setProfCoords] = useState(null);
  const [distanceToProf, setDistanceToProf] = useState(null);
  const [distanceToClass, setDistanceToClass] = useState(null);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const channelRef = useRef(null);

  // Obtain student device IP on mount
  useEffect(() => {
    getLocalIP().then((ip) => {
      if (ip) setStudentIp(ip);
    });
  }, []);

  const getLocalIP = () => {
    return new Promise((resolve) => {
      const pc = new RTCPeerConnection({ iceServers: [] });
      pc.createDataChannel('');
      pc.createOffer().then((offer) => pc.setLocalDescription(offer));
      pc.onicecandidate = (event) => {
        if (!event || !event.candidate) return;
        const candidate = event.candidate.candidate;
        const ipMatch = candidate.match(/([0-9]{1,3}(?:\.[0-9]{1,3}){3})/);
        if (ipMatch) {
          resolve(ipMatch[1]);
          pc.close();
        }
      };
      setTimeout(() => resolve(null), 1500);
    });
  };

  // Sync session state from Professor
  useEffect(() => {
    channelRef.current = createBroadcastChannel((message) => {
        if (message.type === 'SESSION_UPDATE') {
          const session = message.payload;
          if (session.sessionActive) {
            setActiveSession(session);
            if (session.lat && session.lng) {
              setProfCoords({ lat: session.lat, lng: session.lng });
            }
          } else {
            setActiveSession(null);
          }
        }
      });

    // Request active session state on load
    setTimeout(() => {
      postChannelMessage(channelRef.current, 'REQUEST_SESSION_STATE', {});
    }, 500);

    // Get actual GPS location if allowed
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          setActualCoords({ lat: latitude, lng: longitude });
          // Distance to Classroom (30.0444, 31.2357) in meters
          const dist = calculateDistance(latitude, longitude, 30.0444, 31.2357);
          setDistanceToClass(dist);
        },
        (error) => {
          console.warn('Geolocation access denied/failed.');
        }
      );
    }

    return () => {
      stopCamera();
      if (channelRef.current) {
        channelRef.current.close();
      }
    };
  }, []);

// Calculate distance to professor when both coordinates are available
useEffect(() => {
  if (actualCoords && profCoords) {
    const dist = calculateDistance(actualCoords.lat, actualCoords.lng, profCoords.lat, profCoords.lng);
    setDistanceToProf(dist);
  }
}, [actualCoords, profCoords]);

  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3; // Earth radius in meters
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
      Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // in meters
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
      }
    } catch (err) {
      console.warn('Webcam not accessible:', err);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  // Student registration inputs
  const handleStudentChange = (e) => {
    const student = MOCK_STUDENTS.find(s => s.id === e.target.value);
    setSelectedStudent(student);
    if (student) {
      setStudentId(student.id);
      setStudentName(student.name);
    }
  };

  const runSimulation = () => {
    if (!activeSession) {
      alert('لا توجد محاضرة مفعلة حالياً من قبل المعلم. يرجى انتظار تفعيل المحاضرة أولاً.');
      return;
    }

    const effectiveId = studentId.trim();
    const effectiveName = studentName.trim();

    if (!effectiveId || !effectiveName) {
      alert('يرجى إدخال اسم الطالب والرقم الجامعي (ID) أولاً لربطهما بهذا الجهاز.');
      return;
    }

    setScanStep('scanning');
    setLogDetails('جاري قراءة رمز الـ QR وفك تشفير الـ AES-256 المشفر ومطابقته...');
    
    // Step 1: Scan & Decrypt
    setTimeout(() => {
      setScanStep('integrity');
      setLogDetails('فحص سلامة نظام التشغيل (OS Integrity): التحقق من الحماية وتعديل النظام... تم بنجاح');
      
      // Step 2: OS Integrity Check
      setTimeout(() => {
        setScanStep('location');
        const allowedDistance = activeSession?.distanceLimit || 5;
        const gpsDesc = bypassGps 
          ? 'تم التحقق (موقع قاعة التدريس مفعل افتراضياً)' 
          : `إحداثياتك الحالية تبعد ${distanceToProf ? distanceToProf.toFixed(1) : 'غير معروف'} متر عن موقع المعلم (المسموح: حتى ${allowedDistance} متر).`;
        
        // Dynamic Proximity check based on professor's specified limit
        if (!bypassGps && distanceToProf && distanceToProf > allowedDistance) {
          failScan('تم الرفض (مخالف للشروط - خارج المسافة المسموح بها)', `أنت تبعد ${distanceToProf.toFixed(1)} متر عن المعلم (المسافة المسموح بها هي ${allowedDistance} متر فقط).`);
          return;
        }
        setLogDetails(`فحص النطاق الجغرافي (GPS Geofencing): ${gpsDesc}`);

        // Step 3: Location Check
        setTimeout(() => {
          if (!bypassGps && distanceToClass && distanceToClass > allowedDistance) {
            failScan('تم الرفض (مخالف للشروط - خارج نطاق القاعة)', `أنت تبعد ${distanceToClass.toFixed(1)} متراً من القاعة (المسافة المسموح بها هي ${allowedDistance} متر).`);
            return;
          }

          setScanStep('fingerprint');
          setLogDetails('التحقق من بصمة الجهاز (Hardware Fingerprint Binding): التأكد من الربط الحصري بالـ IP...');

          // Step 4: Device Fingerprint check
          setTimeout(() => {
            setScanStep('liveness');
            setLogDetails('فتح الكاميرا الأمامية للتحقق من الحيوية (Liveness Detection): يرجى النظر للكاميرا...');
            startCamera();

            // Step 5: Biometric Liveness
            setTimeout(() => {
              stopCamera();

              // Success path
              const scanResult = {
                studentId: studentId.trim(),
                name: studentName.trim(),
                email: studentEmail || `${studentId.trim()}@pharmacy.edu.eg`,
                status: 'Attended',
                integrity: 'سليم (بصمة جهاز موثقة بالـ IP)',
                gps: bypassGps ? 'مقبول (موقع افتراضي)' : `داخل النطاق (${distanceToProf ? distanceToProf.toFixed(1) : '2.1'}م)`,
                liveness: '99.3% (مطابق وموثق)',
                timestamp: Date.now()
              };
              setScanStep('done');
              setLogDetails('✓ تم تسجيل حضورك بنجاح ومزامنته مع الأستاذ بالوقت الفعلي!');
              postChannelMessage(channelRef.current, 'STUDENT_SCAN', scanResult);

            }, 2500);
          }, 1500);
        }, 1500);
      }, 1500);
    }, 1500);
  };

  const failScan = (reason, details) => {
    stopCamera();
    setScanStep('done');
    setLogDetails(`✗ ${reason}: ${details}`);

    const allowedDist = activeSession?.distanceLimit || 5;
    let gpsStatus = 'سليم';
    if (distanceToProf && distanceToProf > allowedDist) {
      gpsStatus = `خارج المسافة المسموح بها (${distanceToProf.toFixed(1)}م من المعلم)`;
    } else if (!bypassGps && distanceToClass && distanceToClass > allowedDist) {
      gpsStatus = `خارج نطاق القاعة (${distanceToClass.toFixed(1)}م)`;
    }

    const scanResult = {
      studentId: studentId.trim(),
      name: studentName.trim(),
      email: studentEmail || `${studentId.trim()}@pharmacy.edu.eg`,
      status: 'Rejected',
      integrity: 'سليم',
      gps: gpsStatus,
      liveness: '-',
      timestamp: Date.now()
    };
    postChannelMessage(channelRef.current, 'STUDENT_SCAN', scanResult);
  };

  const getStepIndicatorClass = (step) => {
    const order = ['idle', 'scanning', 'integrity', 'location', 'fingerprint', 'liveness', 'done'];
    const currentIdx = order.indexOf(scanStep);
    const stepIdx = order.indexOf(step);

    if (scanStep === 'done' && step !== 'done') return 'badge-success';
    if (currentIdx === stepIdx) return 'active-step';
    if (currentIdx > stepIdx) return 'completed-step';
    return 'pending-step';
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <div className="phone-mockup">
        <div className="phone-header">
          <span>9:41 ص</span>
          <span style={{ fontSize: '0.8rem', color: 'var(--success)' }}>UAMS Secure</span>
        </div>

        <div className="phone-screen">
          <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.2rem', marginBottom: '0.25rem' }}>تسجيل الحضور الذكي</h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: '1rem' }}>
            {activeSession ? (
              <span>
                محاضرة نشطة: <strong style={{ color: 'var(--accent)' }}>{activeSession.lectureTitle || activeSession.course}</strong> ({activeSession.profName || 'المعلم'})
              </span>
            ) : (
              'لا توجد محاضرة نشطة حالياً'
            )}
          </p>

          <div className="card" style={{ padding: '0.85rem', marginBottom: '1rem', border: '1px solid var(--accent)', background: 'rgba(99, 102, 241, 0.08)' }}>
            <label style={{ fontSize: '0.8rem', fontWeight: 800, display: 'block', marginBottom: '0.6rem', color: 'var(--accent)' }}>
              📝 تسجيل بيانات الطالب والجهاز (Device Registration)
            </label>
            <div style={{ marginBottom: '0.5rem' }}>
              <label style={{ fontSize: '0.7rem', color: 'var(--muted)', display: 'block', marginBottom: '0.2rem' }}>الرقم الجامعي (University ID):</label>
              <input 
                type="text" 
                placeholder="أدخل الرقم الجامعي (مثال: 2024-PHARM-099)" 
                value={studentId} 
                onChange={(e) => setStudentId(e.target.value)}
                disabled={scanStep !== 'idle' && scanStep !== 'done'}
                style={{ fontSize: '0.85rem', padding: '0.6rem 0.75rem', marginBottom: '0.6rem' }}
              />
              <label style={{ fontSize: '0.7rem', color: 'var(--muted)', display: 'block', marginBottom: '0.2rem' }}>اسم الطالب الثلاثي (Full Name):</label>
              <input 
                type="text" 
                placeholder="أدخل اسم الطالب الثلاثي" 
                value={studentName} 
                onChange={(e) => setStudentName(e.target.value)}
                disabled={scanStep !== 'idle' && scanStep !== 'done'}
                style={{ fontSize: '0.85rem', padding: '0.6rem 0.75rem' }}
              />
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--muted)', display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px dashed var(--surface-border)' }}>
              <span>IP وتوقيع الجهاز:</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--success)', fontWeight: 700 }}>
                {studentIp || '192.168.1.105 (مسجل)'}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', alignItems: 'center' }}>
            <input 
              type="checkbox" 
              id="bypassGps" 
              checked={bypassGps} 
              onChange={(e) => setBypassGps(e.target.checked)} 
              disabled={scanStep !== 'idle' && scanStep !== 'done'}
              style={{ width: 'auto' }}
            />
            <label htmlFor="bypassGps" style={{ fontSize: '0.75rem', color: 'var(--muted)', cursor: 'pointer' }}>
              محاكاة موقع قاعة الدرس (لتخطي فحص النطاق الجغرافي)
            </label>
          </div>

          {/* Camera Frame View */}
          <div className="phone-camera-simulate">
            {scanStep === 'liveness' && <div className="face-overlay"></div>}
            {scanStep === 'liveness' ? (
              <video ref={videoRef} autoPlay playsInline className="phone-video-stream" />
            ) : (
              <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--muted)' }}>
                {scanStep === 'scanning' && <div className="scanner-line"></div>}
                <Camera size={32} style={{ marginBottom: '0.5rem', color: 'var(--muted)' }} />
                <span style={{ fontSize: '0.75rem', display: 'block' }}>الكاميرا مغلقة</span>
              </div>
            )}
          </div>

          {/* Steps Display */}
          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--surface-border)', borderRadius: '12px', padding: '1rem', flex: 1, overflowY: 'auto' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--muted)', marginBottom: '0.5rem' }}>حالة الفحوصات الأمنية:</div>
            <div style={{ fontSize: '0.8rem', lineHeight: '1.4', minHeight: '3rem' }}>
              {logDetails}
            </div>

            {scanStep !== 'idle' && (
              <div style={{ marginTop: '1rem', display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                <span className={`badge ${scanStep === 'scanning' ? 'badge-warning' : 'badge-success'}`}>
                  QR Scan
                </span>
                <span className={`badge ${scanStep === 'integrity' ? 'badge-warning' : (scanStep === 'scanning' ? 'badge-secondary' : 'badge-success')}`}>
                  Integrity
                </span>
                <span className={`badge ${scanStep === 'location' ? 'badge-warning' : (scanStep === 'scanning' || scanStep === 'integrity' ? 'badge-secondary' : 'badge-success')}`}>
                  GPS Check
                </span>
                <span className={`badge ${scanStep === 'fingerprint' ? 'badge-warning' : (scanStep === 'liveness' || scanStep === 'done' ? 'badge-success' : 'badge-secondary')}`}>
                  Device ID
                </span>
                <span className={`badge ${scanStep === 'liveness' ? 'badge-warning' : (scanStep === 'done' ? 'badge-success' : 'badge-secondary')}`}>
                  Liveness
                </span>
              </div>
            )}
          </div>

          <button 
            className="btn" 
            style={{ width: '100%', marginTop: '1rem' }} 
            onClick={runSimulation}
            disabled={!activeSession || (scanStep !== 'idle' && scanStep !== 'done')}
          >
            {activeSession ? '📱 ابدأ الفحص وتسجيل الحضور' : 'المحاضرة غير مفعلة'}
          </button>
        </div>
      </div>
    </div>
  );
}
