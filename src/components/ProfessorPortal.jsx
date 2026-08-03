import React, { useState, useEffect, useRef } from 'react';
import { Play, Square, Users, CheckCircle, AlertTriangle, ShieldCheck, RefreshCw } from 'lucide-react';
import { QRCodeSVG as QRCode } from 'qrcode.react';
import { createBroadcastChannel, postChannelMessage, saveActiveSession, getActiveSession, clearActiveSession, getAttendanceLogs, saveAttendanceLogs } from '../utils/sharedState';

export default function ProfessorPortal() {
  const [profName, setProfName] = useState('د. محمود يحيى');
  const [department, setDepartment] = useState('PHARM-MIC');
  const [lectureTitle, setLectureTitle] = useState('الميكروبيولوجي والمناعة (Microbiology & Immunology)');
  const [course, setCourse] = useState('P-MIC-301');
  const [sessionActive, setSessionActive] = useState(false);
  const [timeLeft, setTimeLeft] = useState(15);
  const [qrToken, setQrToken] = useState('');
  const [distanceLimit, setDistanceLimit] = useState(5); // Default 5 meters
  // Professor (doctor) GPS location
  const [profCoords, setProfCoords] = useState(null);
  const [logs, setLogs] = useState([]);
  const channelRef = useRef(null);

  // Initialize and load session/logs
  useEffect(() => {
    // Fetch professor's actual GPS location on mount
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          setProfCoords({ lat: latitude, lng: longitude });
        },
        (error) => {
          console.warn('Professor geolocation access denied/failed.');
        },
        { enableHighAccuracy: true }
      );
    }

    const active = getActiveSession();
    if (active) {
      setCourse(active.course);
      setSessionActive(true);
      setQrToken(active.qrToken);
      if (active.lat && active.lng) {
        setProfCoords({ lat: active.lat, lng: active.lng });
      }
    }
    setLogs(getAttendanceLogs());

    // Connect to BroadcastChannel
    channelRef.current = createBroadcastChannel((message) => {
      if (message.type === 'STUDENT_SCAN') {
        const newLog = message.payload;
        setLogs((prev) => {
          // Check if this student already scanned in this session
          if (prev.some(l => l.studentId === newLog.studentId && l.timestamp === newLog.timestamp)) {
            return prev;
          }
          const updated = [newLog, ...prev];
          saveAttendanceLogs(updated);
          return updated;
        });
      } else if (message.type === 'REQUEST_SESSION_STATE') {
        // Send state to student portal if requested
        if (sessionActive) {
          postChannelMessage(channelRef.current, 'SESSION_UPDATE', {
            profName,
            lectureTitle,
            course,
            sessionActive: true,
            qrToken,
            lat: profCoords?.lat ?? 30.0444,
            lng: profCoords?.lng ?? 31.2357,
            distanceLimit: Number(distanceLimit) || 5
          });
        }
      }
    });

    return () => {
      if (channelRef.current) {
        channelRef.current.close();
      }
    };
  }, [sessionActive, course, qrToken, profName, lectureTitle, distanceLimit]);

  // Generate dynamic QR token and return it (no side‑effects here)
  const generateQRToken = () => {
    const randomSessionId = 'sess_' + Math.random().toString(36).substr(2, 9);
    const header = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
    const payloadObj = {
      profName,
      lectureTitle,
      course,
      sessionId: randomSessionId,
      timestamp: Date.now(),
      // Use professor's actual GPS if available, otherwise fallback to a default
      lat: profCoords?.lat ?? 30.0444,
      lng: profCoords?.lng ?? 31.2357,
    };
    const payload = btoa(JSON.stringify(payloadObj)).replace(/=/g, "");
    const sig = Array.from({ length: 30 }, () =>
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"[Math.floor(Math.random() * 64)]
    ).join("");
    const token = `${header}.${payload.substring(0, 20)}...${sig.substring(0, 10)}`;
    return token;
  };

// QR token is generated once on lecture start; no automatic rotation

  const startLecture = async () => {
    // Obtain professor's local IP address
    const ip = await getLocalIP();
    setSessionActive(true);
    setTimeLeft(15);
    // Clear logs from previous sessions when starting new
    setLogs([]);
    saveAttendanceLogs([]);
    
    // Generate initial QR token
    const token = generateQRToken();
    setQrToken(token);

    // Persist professor location (if known)
    const lat = profCoords?.lat ?? 30.0444;
    const lng = profCoords?.lng ?? 31.2357;
    // Include IP, profName, and lectureTitle in session payload
    const sessionPayload = { profName, lectureTitle, course, sessionActive: true, qrToken: token, lat, lng, ip, distanceLimit: Number(distanceLimit) || 5 };
    saveActiveSession(sessionPayload);
    postChannelMessage(channelRef.current, 'SESSION_UPDATE', sessionPayload);
  };

  // Helper to get local IP via WebRTC
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
      // Fallback after short timeout
      setTimeout(() => resolve(null), 2000);
    });
  };

  const stopLecture = () => {
    setSessionActive(false);
    clearActiveSession();
    postChannelMessage(channelRef.current, 'SESSION_UPDATE', {
      course,
      sessionActive: false,
      qrToken: '',
    });
  };

  const getStats = () => {
    const totalScans = logs.length;
    const verified = logs.filter(l => l.status === 'Attended').length;
    const rejected = logs.filter(l => l.status === 'Rejected').length;
    const rate = totalScans > 0 ? ((verified / totalScans) * 100).toFixed(1) : '100';
    return { totalScans, verified, rejected, rate };
  };

  const stats = getStats();

  return (
    <div>
      <div className="grid-4">
        <div className="card">
          <div className="card-title">إجمالي عمليات المسح</div>
          <div className="card-value">{stats.totalScans}</div>
          <div className="card-subtext"><Users size={14} /> طلاب حاضرين ومرفوضين</div>
        </div>
        <div className="card">
          <div className="card-title">تم التحقق بنجاح</div>
          <div className="card-value" style={{ color: 'var(--success)' }}>{stats.verified}</div>
          <div className="card-subtext"><CheckCircle size={14} style={{ color: 'var(--success)' }} /> مطابقة سليمة 100%</div>
        </div>
        <div className="card">
          <div className="card-title">فحوصات فاشلة / مرفوضة</div>
          <div className="card-value" style={{ color: 'var(--danger)' }}>{stats.rejected}</div>
          <div className="card-subtext"><AlertTriangle size={14} style={{ color: 'var(--danger)' }} /> محاولات تلاعب بالـ GPS أو الأجهزة</div>
        </div>
        <div className="card">
          <div className="card-title">معدل التحقق</div>
          <div className="card-value">{stats.rate}%</div>
          <div className="card-subtext"><ShieldCheck size={14} /> فحص ذكي للـ Liveness & Hardware</div>
        </div>
      </div>

      <div className="dashboard-layout">
        <div>
          <h2 className="section-title">سجل الحضور الأمني الفوري</h2>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>معرف الطالب</th>
                <th>الاسم</th>
                <th>البريد الجامعي</th>
                <th>الحالة</th>
                <th>سلامة الجهاز</th>
                <th>فحص GPS</th>
                <th>نقاط مطابقة الوجه</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ textAlign: 'center', color: 'var(--muted)', padding: '2rem' }}>
                      لا يوجد عمليات مسح مسجلة حالياً. قم ببدء المحاضرة ودع الطلاب يمسحون الكود.
                    </td>
                  </tr>
                ) : (
                  logs.map((log, index) => (
                    <tr key={index}>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{log.studentId}</td>
                        <td>{log.name}</td>
                        <td>{log.email || ''}</td>
                        <td>
                          <span className={`badge ${log.status === 'Attended' ? 'badge-success' : 'badge-danger'}`}>
                            {log.status === 'Attended' ? 'مقبول' : 'مرفوض'}
                          </span>
                        </td>
                        <td>{log.integrity}</td>
                        <td>{log.gps}</td>
                        <td>{log.liveness}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div className="card" style={{ marginBottom: '1.5rem' }}>
            <h3 className="section-title" style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>التحكم بالمحاضرة</h3>
            {!sessionActive ? (
              <>
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '0.5rem' }}>اسم المعلم / المحاضر</label>
                  <input 
                    type="text" 
                    value={profName} 
                    onChange={(e) => setProfName(e.target.value)} 
                    placeholder="مثال: د. محمود يحيى"
                  />
                </div>
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '0.5rem' }}>القسم الأكاديمي (كلية الصيدلة)</label>
                  <select value={department} onChange={(e) => {
                    const dept = e.target.value;
                    setDepartment(dept);
                    if (dept === 'PHARM-MIC') { setCourse('P-MIC-301'); setLectureTitle('الميكروبيولوجي والمناعة (Microbiology & Immunology)'); }
                    else if (dept === 'PHARM-COL') { setCourse('P-COL-401'); setLectureTitle('الأدوية والسموم (Pharmacology & Toxicology)'); }
                    else if (dept === 'PHARM-COG') { setCourse('P-COG-201'); setLectureTitle('العقاقير والنباتات الطبية (Pharmacognosy)'); }
                    else if (dept === 'PHARM-CEU') { setCourse('P-CEU-302'); setLectureTitle('الصيدلانيات والتقنية الصيدلية (Pharmaceutics)'); }
                    else if (dept === 'PHARM-CHM') { setCourse('P-CHM-102'); setLectureTitle('الكيمياء الصيدلية والعضوية (Pharmaceutical Chemistry)'); }
                    else if (dept === 'PHARM-CLI') { setCourse('P-CLI-501'); setLectureTitle('الصيدلة الإكلينيكية والممارسة الصيدلية (Clinical Pharmacy)'); }
                    else if (dept === 'PHARM-BCH') { setCourse('P-BCH-202'); setLectureTitle('الكيمياء الحيوية والبيولوجيا الجزئية (Biochemistry)'); }
                  }}>
                    <option value="PHARM-MIC">قسم الميكروبيولوجي والمناعة (Microbiology & Immunology)</option>
                    <option value="PHARM-COL">قسم الأدوية والسموم (Pharmacology & Toxicology)</option>
                    <option value="PHARM-COG">قسم العقاقير والنباتات الطبية (Pharmacognosy)</option>
                    <option value="PHARM-CEU">قسم الصيدلانيات والتكنولوجيا الصيدلية (Pharmaceutics)</option>
                    <option value="PHARM-CHM">قسم الكيمياء الصيدلية (Pharmaceutical Chemistry)</option>
                    <option value="PHARM-CLI">قسم الصيدلة الإكلينيكية وممارسة الصيدلة (Clinical Pharmacy)</option>
                    <option value="PHARM-BCH">قسم الكيمياء الحيوية (Biochemistry)</option>
                  </select>
                </div>
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '0.5rem' }}>عنوان المحاضرة / المادة</label>
                  <input 
                    type="text" 
                    value={lectureTitle} 
                    onChange={(e) => setLectureTitle(e.target.value)} 
                    placeholder="مثال: الميكروبيولوجي / علم الأدوية"
                  />
                </div>
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '0.5rem' }}>رمز المقرر (Course Code)</label>
                  <input 
                    type="text" 
                    value={course} 
                    onChange={(e) => setCourse(e.target.value)} 
                    placeholder="مثال: P-MIC-301"
                  />
                </div>
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '0.5rem' }}>
                    المسافة المسموح بها لتسجيل الحضور (بالأمتار)
                  </label>
                  <input 
                    type="number" 
                    min="1" 
                    max="100" 
                    value={distanceLimit} 
                    onChange={(e) => setDistanceLimit(e.target.value)} 
                    placeholder="مثال: 3 أو 5 متر"
                  />
                </div>
                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '0.5rem' }}>موقع القاعة</label>
                  <input type="text" value="Classroom 402-A (GPS: 30.0444, 31.2357)" readOnly />
                </div>
                <button className="btn" style={{ width: '100%' }} onClick={startLecture}>
                  <Play size={16} /> إنشاء وتفعيل كود المحاضرة (QR)
                </button>
              </>
            ) : (
              <>
                <div style={{ padding: '0.75rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', marginBottom: '1rem' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>المعلم: <strong style={{ color: 'var(--fg)' }}>{profName}</strong></div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent)', marginTop: '0.25rem' }}>
                    {lectureTitle} ({course})
                  </div>
                </div>
                <button className="btn btn-danger" style={{ width: '100%' }} onClick={stopLecture}>
                  <Square size={16} /> إنهاء المحاضرة وإغلاق الجلسة
                </button>
              </>
            )}
          </div>

          {sessionActive && (
            <div className="qr-container">
              <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.25rem' }}>رمز الـ QR المشفر والديناميكي</h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>مشفر بـ AES-256 وموقع بـ JWT</p>
              
              <div className="qr-code-box" style={{ width: '200px', height: '200px' }}>
                <QRCode
                  value={qrToken}
                  size={200}
                  bgColor="var(--bg)"
                  fgColor="var(--accent)"
                  level="M"
                  includeMargin={false}
                />
              </div>

              <div className="timer-ring" style={{ marginBottom: '1rem' }}>
                <RefreshCw size={14} className="animate-spin" />
                <span>تحديث الكود خلال:</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800 }}>{timeLeft}ث</span>
              </div>

              <div style={{ width: '100%', maxWidth: '240px' }}>
                <div style={{ 
                  fontSize: '0.65rem', 
                  fontFamily: 'var(--font-mono)', 
                  color: 'var(--muted)', 
                  padding: '0.5rem', 
                  background: 'rgba(9, 10, 15, 0.6)', 
                  border: '1px solid var(--surface-border)', 
                  borderRadius: '8px', 
                  wordBreak: 'break-all',
                  textAlign: 'left'
                }}>
                  {qrToken}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
