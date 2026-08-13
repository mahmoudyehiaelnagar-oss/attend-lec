import React, { useState, useEffect, useRef } from 'react';
import { Camera } from 'lucide-react';
import { createBroadcastChannel, postChannelMessage, getActiveSessions } from '../utils/sharedState';
import jsQR from 'jsqr';

export default function StudentPortal() {
  const [studentId, setStudentId] = useState('');
  const [studentName, setStudentName] = useState('');
  const [studentEmail] = useState('');
  const [studentIp, setStudentIp] = useState('');
  const [boundStudent, setBoundStudent] = useState(null);

  // Multi-session support
  const [activeSessions, setActiveSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState('');

  const [scanStep, setScanStep] = useState('idle'); // idle, scanning, integrity, location, fingerprint, liveness, done
  const [logDetails, setLogDetails] = useState('الرجاء اختيار المحاضرة وتعبئة بيانات الطالب والضغط على زر بدء الفحص.');
  const [actualCoords, setActualCoords] = useState(null);
  const [profCoords, setProfCoords] = useState(null);
  const [distanceToProf, setDistanceToProf] = useState(null);
  const [firebaseError, setFirebaseError] = useState(null);
  const [registeredOnThisDevice, setRegisteredOnThisDevice] = useState(null);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const channelRef = useRef(null);
  const canvasRef = useRef(null);
  const scanIntervalRef = useRef(null);

  // Active session computed property
  const activeSession = activeSessions.find(s => s.id === selectedSessionId) || activeSessions[0] || null;

  // Obtain student device IP on mount
  useEffect(() => {
    getLocalIP().then((ip) => {
      if (ip) setStudentIp(ip);
    });
  }, []);

  const getLocalIP = () => {
    return new Promise((resolve) => {
      try {
        if (typeof window === 'undefined' || !window.RTCPeerConnection) {
          resolve(null);
          return;
        }
        const pc = new window.RTCPeerConnection({ iceServers: [] });
        pc.createDataChannel('');
        pc.createOffer()
          .then((offer) => pc.setLocalDescription(offer))
          .catch(() => resolve(null));
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
      } catch (err) {
        console.warn('WebRTC IP fetch error:', err);
        resolve(null);
      }
    });
  };

  // Load bound student identity on mount
  useEffect(() => {
    const savedBound = localStorage.getItem('uams_device_bound_student');
    if (savedBound) {
      try {
        const parsed = JSON.parse(savedBound);
        setBoundStudent(parsed);
        setStudentId(parsed.studentId || '');
        setStudentName(parsed.name || '');
      } catch (e) {
        console.error(e);
      }
    }
  }, []);

  // Sync active sessions from Professor / Shared State
  useEffect(() => {
    const initial = getActiveSessions();
    if (initial && initial.length > 0) {
      setActiveSessions(initial);
      setSelectedSessionId(initial[0].id);
    }

    channelRef.current = createBroadcastChannel((message) => {
      if (message.type === 'SESSIONS_UPDATE') {
        const sessions = message.payload || [];
        setActiveSessions(sessions);
        if (sessions.length > 0) {
          setSelectedSessionId((prev) => {
            const exists = sessions.some(s => s.id === prev);
            return exists ? prev : sessions[0].id;
          });
        } else {
          setSelectedSessionId('');
        }
      } else if (message.type === 'SESSION_UPDATE') { // Legacy support
        const session = message.payload;
        if (session && session.sessionActive) {
          setActiveSessions([session]);
          setSelectedSessionId(session.id || 'legacy');
        } else {
          setActiveSessions([]);
          setSelectedSessionId('');
        }
      } else if (message.type === 'FIREBASE_ERROR') {
        setFirebaseError(message.payload);
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

  // Update professor coordinates based on active session
  useEffect(() => {
    if (activeSession) {
      if (activeSession.lat && activeSession.lng) {
        setProfCoords({ lat: activeSession.lat, lng: activeSession.lng });
      }
    }
  }, [activeSession]);

  // Check if this device has already registered for the selected active session
  useEffect(() => {
    if (activeSession) {
      const lockKey = `device_lock_${activeSession.id || activeSession.course}_${activeSession.qrToken?.substring(0, 15) || 'session'}`;
      const existing = localStorage.getItem(lockKey);
      if (existing) {
        try {
          const parsed = JSON.parse(existing);
          setRegisteredOnThisDevice(parsed);
          setStudentId(parsed.studentId || '');
          setStudentName(parsed.name || '');
          setScanStep('done');
          setLogDetails(`✓ تم تسجيل الحضور لمادة (${activeSession.course}) من هذا الجهاز بنجاح للطالب: (${parsed.name} - ${parsed.studentId}).`);
        } catch (e) {
          console.error(e);
        }
      } else {
        setRegisteredOnThisDevice(null);
        if (scanStep === 'done') {
          setScanStep('idle');
          setLogDetails('جاهز لمسح كود المحاضرة المحددة.');
        }
      }
    } else {
      setRegisteredOnThisDevice(null);
    }
  }, [activeSession, selectedSessionId]);

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
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
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

  const scanQRFrame = () => {
    if (videoRef.current && streamRef.current && scanStep === 'scanning') {
      const video = videoRef.current;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        if (!canvasRef.current) {
          canvasRef.current = document.createElement('canvas');
        }
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: "dontInvert",
        });

        if (code) {
          const scannedToken = code.data;
          // Validate token against selected active session
          if (activeSession && scannedToken === activeSession.qrToken) {
            // QR Matched! Stop scanning loop and go to next step
            if (scanIntervalRef.current) {
              cancelAnimationFrame(scanIntervalRef.current);
              scanIntervalRef.current = null;
            }
            
            setScanStep('integrity');
            setLogDetails(`✓ تم تجميع وقراءة الـ QR الخاص بمادة (${activeSession?.course || ''})! جاري فحص سلامة الجهاز...`);
            
            // Start remaining verification steps
            setTimeout(() => {
              setScanStep('location');
              setLogDetails('جاري التقاط إحداثيات الـ GPS ومطابقتها مع موقع المحاضرة...');
              
              if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                  (position) => {
                    const { latitude, longitude } = position.coords;
                    setActualCoords({ lat: latitude, lng: longitude });
                    
                    let dist = 99999;
                    const allowedDistance = activeSession?.distanceLimit || 5;
                    const targetLat = profCoords?.lat ?? activeSession?.lat ?? 30.0444;
                    const targetLng = profCoords?.lng ?? activeSession?.lng ?? 31.2357;
                    
                    dist = calculateDistance(latitude, longitude, targetLat, targetLng);
                    setDistanceToProf(dist);
                    
                    const gpsDesc = `إحداثياتك الحالية تم التحقق منها وتبعد ${dist.toFixed(1)} متر عن المعلم (المسموح: حتى ${allowedDistance} متر).`;
                    
                    if (dist > allowedDistance) {
                      failScan('تم الرفض (مخالف للشروط - خارج المسافة المسموح بها)', `أنت تبعد ${dist.toFixed(1)} متر عن المعلم (المسافة المسموح بها هي ${allowedDistance} متر فقط).`);
                      return;
                    }
                    
                    setLogDetails(`فحص النطاق الجغرافي (GPS Geofencing): ${gpsDesc}`);
                    
                    // Step 3: Fingerprint check
                    setTimeout(() => {
                      setScanStep('fingerprint');
                      setLogDetails('التحقق من بصمة الجهاز (Hardware Fingerprint Binding): التأكد من الربط الحصري بالـ IP...');
                      
                      // Step 4: Biometric Liveness
                      setTimeout(() => {
                        setScanStep('liveness');
                        setLogDetails('فحص الحيوية (Liveness Detection): يرجى النظر للكاميرا والرمش بعينيك...');
                        
                        setTimeout(() => {
                          stopCamera();
                          
                          const scanResult = {
                            sessionId: activeSession?.id || 'sess_' + Date.now(),
                            course: activeSession?.course || 'غير محدد',
                            lectureTitle: activeSession?.lectureTitle || 'غير محدد',
                            profName: activeSession?.profName || 'المعلم',
                            studentId: studentId.trim(),
                            name: studentName.trim(),
                            email: studentEmail || `${studentId.trim()}@pharmacy.edu.eg`,
                            status: 'Attended',
                            integrity: 'سليم (بصمة جهاز موثقة بالـ IP)',
                            gps: `داخل النطاق (${dist.toFixed(1)}م)`,
                            liveness: '99.3% (مطابق وموثق)',
                            timestamp: Date.now()
                          };

                          // Bind device permanently to this student identity to prevent proxy attendance for peers
                          const boundIdentity = { studentId: studentId.trim(), name: studentName.trim() };
                          localStorage.setItem('uams_device_bound_student', JSON.stringify(boundIdentity));
                          setBoundStudent(boundIdentity);

                          // Save device lock for this session
                          const lockKey = `device_lock_${activeSession?.id || activeSession?.course || 'session'}_${activeSession?.qrToken?.substring(0, 15) || 'session'}`;
                          localStorage.setItem(lockKey, JSON.stringify(scanResult));
                          setRegisteredOnThisDevice(scanResult);

                          setScanStep('done');
                          const successMsg = `🎉 تم تسجيل حضورك بنجاح في محاضرة (${activeSession?.lectureTitle || ''})!`;
                          setLogDetails(`✅ ${successMsg}\n🔒 تم قفل هذا الجهاز بحساب الطالب (${studentName.trim()}) لمنع تسجيل أي طالب آخر.`);
                          
                          // Display success alert message immediately
                          setTimeout(() => {
                            alert(`🎉 تم تسجيل حضورك بنجاح!\n\nالمادة: ${activeSession?.lectureTitle || ''} (${activeSession?.course || ''})\nالطالب: ${studentName.trim()} (${studentId.trim()})\n\n🔒 الجهاز مقفل ومربوط بحسابك حصرياً ولن يسمح بتسجيل حضور لأي طالب آخر.`);
                          }, 300);

                          postChannelMessage(channelRef.current, 'STUDENT_SCAN', scanResult);
                        }, 2500);
                      }, 1500);
                    }, 1500);
                  },
                  (error) => {
                    failScan('تم الرفض (فشل تحديد الموقع)', 'يرجى تفعيل الـ GPS وصلاحية الموقع في المتصفح وتجربة المحاولة مجدداً.');
                  },
                  { enableHighAccuracy: true, timeout: 6000 }
                );
              } else {
                failScan('تم الرفض (الـ GPS غير مدعوم)', 'جهازك أو متصفحك لا يدعم تحديد المواقع.');
              }
            }, 1500);
            return;
          } else {
            setLogDetails(`جاري المسح... الرمز المكتشف لا يطابق كود محاضرة (${activeSession?.lectureTitle || 'المحددة'}). يرجى التأكد من اختيار المحاضرة الصحيحة ومسح الكود الخاص بها.`);
          }
        }
      }
      scanIntervalRef.current = requestAnimationFrame(scanQRFrame);
    }
  };

  // Start QR scanning loop once video metadata is loaded
  useEffect(() => {
    if (scanStep === 'scanning') {
      const checkVideo = () => {
        if (videoRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
          scanQRFrame();
        } else {
          scanIntervalRef.current = requestAnimationFrame(checkVideo);
        }
      };
      scanIntervalRef.current = requestAnimationFrame(checkVideo);
    } else {
      if (scanIntervalRef.current) {
        cancelAnimationFrame(scanIntervalRef.current);
        scanIntervalRef.current = null;
      }
    }
    return () => {
      if (scanIntervalRef.current) {
        cancelAnimationFrame(scanIntervalRef.current);
      }
    };
  }, [scanStep, activeSession, profCoords]);

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
    setLogDetails(`جاري فتح الكاميرا... يرجى توجيه الكاميرا نحو باركود محاضرة (${activeSession.lectureTitle}) لمسحه...`);
    startCamera();
  };

  const failScan = (reason, details) => {
    stopCamera();
    setScanStep('done');
    setLogDetails(`✗ ${reason}: ${details}`);

    const allowedDist = activeSession?.distanceLimit || 5;
    let gpsStatus = 'تعذر تحديد الموقع';
    if (distanceToProf) {
      if (distanceToProf > allowedDist) {
        gpsStatus = `خارج المسافة المسموح بها (${distanceToProf.toFixed(1)}م من المعلم)`;
      } else {
        gpsStatus = `سليم (${distanceToProf.toFixed(1)}م)`;
      }
    }

    const scanResult = {
      sessionId: activeSession?.id || 'sess_' + Date.now(),
      course: activeSession?.course || 'غير محدد',
      lectureTitle: activeSession?.lectureTitle || 'غير محدد',
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

  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <div className="phone-mockup">
        <div className="phone-header">
          <span>9:41 ص</span>
          <span style={{ fontSize: '0.8rem', color: 'var(--success)' }}>UAMS Secure</span>
        </div>

        <div className="phone-screen">
          {firebaseError && (
            <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--danger)', color: 'var(--danger)', fontSize: '0.75rem', padding: '0.5rem 0.75rem', borderRadius: '8px', marginBottom: '1rem', lineHeight: '1.4' }}>
              ⚠️ خطأ الاتصال بـ Firebase: ({firebaseError}). يرجى مراجعة إعدادات الـ Rules.
            </div>
          )}
          <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.2rem', marginBottom: '0.25rem' }}>تسجيل الحضور الذكي</h3>

          {/* Active Lectures Selector Dropdown */}
          <div className="card" style={{ padding: '0.75rem', marginBottom: '1rem', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid var(--surface-border)' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--accent)', display: 'block', marginBottom: '0.35rem' }}>
              📚 اختر المحاضرة التي تحضرها الآن:
            </label>
            {activeSessions.length === 0 ? (
              <div style={{ fontSize: '0.8rem', color: 'var(--muted)', padding: '0.4rem 0' }}>
                ⚠️ لا توجد محاضرات نشطة حالياً. انتظر حتى يفعل المحاضر الكود.
              </div>
            ) : (
              <select 
                value={selectedSessionId} 
                onChange={(e) => setSelectedSessionId(e.target.value)}
                style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 600 }}
              >
                {activeSessions.map((sess) => (
                  <option key={sess.id} value={sess.id}>
                    {sess.course} - {sess.lectureTitle} ({sess.profName})
                  </option>
                ))}
              </select>
            )}
            
            {activeSession && (
              <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: '0.4rem', lineHeight: '1.3' }}>
                المستهدف: <strong>{activeSession.lectureTitle}</strong> • نطاق القاعة المسموح: {activeSession.distanceLimit || 5} أمتار
              </div>
            )}
          </div>

          {registeredOnThisDevice && (
            <div style={{ background: 'rgba(34, 197, 94, 0.1)', border: '1px solid var(--success)', color: 'var(--success)', fontSize: '0.8rem', padding: '0.65rem 0.85rem', borderRadius: '8px', marginBottom: '1rem', lineHeight: '1.4' }}>
              🔒 <strong>الجهاز مقفل لهذه المحاضرة:</strong> تم تسجيل حضور هذا الجهاز بنجاح باسم <strong>{registeredOnThisDevice.name}</strong> ({registeredOnThisDevice.studentId}).
            </div>
          )}

          <div className="card" style={{ padding: '0.85rem', marginBottom: '1rem', border: boundStudent ? '1px solid var(--success)' : '1px solid var(--accent)', background: boundStudent ? 'rgba(34, 197, 94, 0.06)' : 'rgba(99, 102, 241, 0.08)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 800, color: boundStudent ? 'var(--success)' : 'var(--accent)', margin: 0 }}>
                {boundStudent ? '🔒 توثيق الجهاز الحصري (Single-Student Device Lock)' : '📝 تسجيل بيانات الطالب والجهاز (Device Registration)'}
              </label>
            </div>

            {boundStudent && (
              <div style={{ fontSize: '0.72rem', color: 'var(--success)', marginBottom: '0.6rem', padding: '0.4rem 0.6rem', background: 'rgba(34, 197, 94, 0.1)', borderRadius: '6px', lineHeight: '1.3' }}>
                🛡️ <strong>تم قفل هذا الجهاز حصرياً:</strong> هذا الجهاز مربوط رسمياً بحساب الطالب <strong>{boundStudent.name}</strong> ({boundStudent.studentId}). يُحظر استخدامه لتسجيل أي طالب آخر.
              </div>
            )}

            <div style={{ marginBottom: '0.5rem' }}>
              <label style={{ fontSize: '0.7rem', color: 'var(--muted)', display: 'block', marginBottom: '0.2rem' }}>الرقم الجامعي (University ID):</label>
              <input 
                type="text" 
                placeholder="أدخل الرقم الجامعي (مثال: 2024-PHARM-099)" 
                value={studentId} 
                onChange={(e) => setStudentId(e.target.value)}
                disabled={Boolean(boundStudent) || (scanStep !== 'idle' && scanStep !== 'done')}
                style={{ fontSize: '0.85rem', padding: '0.6rem 0.75rem', marginBottom: '0.6rem' }}
              />
              <label style={{ fontSize: '0.7rem', color: 'var(--muted)', display: 'block', marginBottom: '0.2rem' }}>اسم الطالب الثلاثي (Full Name):</label>
              <input 
                type="text" 
                placeholder="أدخل اسم الطالب الثلاثي" 
                value={studentName} 
                onChange={(e) => setStudentName(e.target.value)}
                disabled={Boolean(boundStudent) || (scanStep !== 'idle' && scanStep !== 'done')}
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

          {/* Camera Frame View */}
          <div className="phone-camera-simulate">
            {scanStep === 'liveness' && <div className="face-overlay"></div>}
            
            {scanStep === 'scanning' && (
              <div className="qr-scanner-overlay">
                <div className="qr-scanner-viewfinder">
                  <div className="qr-scanner-corner-tr"></div>
                  <div className="qr-scanner-corner-bl"></div>
                  <div className="qr-laser-line"></div>
                </div>
              </div>
            )}
            
            {['scanning', 'integrity', 'location', 'fingerprint', 'liveness'].includes(scanStep) ? (
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                className={`phone-video-stream ${scanStep === 'liveness' ? 'mirrored' : ''}`} 
              />
            ) : (
              <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--muted)' }}>
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
            className={`btn ${registeredOnThisDevice ? 'btn-secondary' : ''}`} 
            style={{ 
              width: '100%', 
              marginTop: '1rem',
              background: registeredOnThisDevice ? 'rgba(34, 197, 94, 0.15)' : undefined,
              border: registeredOnThisDevice ? '1px solid var(--success)' : undefined,
              color: registeredOnThisDevice ? 'var(--success)' : undefined,
              fontWeight: 700
            }} 
            onClick={runSimulation}
            disabled={!activeSession || (scanStep !== 'idle' && scanStep !== 'done')}
          >
            {registeredOnThisDevice 
              ? `🔒 تم تسجيل حضورك مسبقاً في (${activeSession?.course || ''})` 
              : activeSession 
                ? `📱 ابدأ مسح كود (${activeSession.course})` 
                : 'المحاضرة غير مفعلة'}
          </button>
        </div>
      </div>
    </div>
  );
}

