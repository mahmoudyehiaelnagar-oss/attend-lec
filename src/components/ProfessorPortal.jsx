import React, { useState, useEffect, useRef } from 'react';
import { Play, Square, Users, CheckCircle, AlertTriangle, ShieldCheck, Download, Plus, BookOpen, Trash2 } from 'lucide-react';
import { QRCodeSVG as QRCode } from 'qrcode.react';
import { createBroadcastChannel, postChannelMessage, saveActiveSessions, getActiveSessions, getAttendanceLogs, saveAttendanceLogs, clearAllAttendanceLogs } from '../utils/sharedState';

export default function ProfessorPortal() {
  const [profName, setProfName] = useState('د. محمود يحيى');
  const [department, setDepartment] = useState('PHARM-MIC');
  const [lectureTitle, setLectureTitle] = useState('الميكروبيولوجي والمناعة (Microbiology & Immunology)');
  const [course, setCourse] = useState('P-MIC-301');
  const [distanceLimit, setDistanceLimit] = useState(5); // Default 5 meters

  // Multi-session management
  const [activeSessions, setActiveSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState('all'); // 'all' or specific session id

  // Professor (doctor) GPS location
  const [profCoords, setProfCoords] = useState(null);
  const [logs, setLogs] = useState([]);
  const [firebaseError, setFirebaseError] = useState(null);
  const channelRef = useRef(null);

  // Initialize and load sessions/logs
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

    const saved = getActiveSessions();
    if (saved && saved.length > 0) {
      setActiveSessions(saved);
      setSelectedSessionId(saved[0].id);
    }
    setLogs(getAttendanceLogs());

    // Connect to BroadcastChannel
    channelRef.current = createBroadcastChannel((message) => {
      if (message.type === 'STUDENT_SCAN') {
        const newLog = message.payload;
        setLogs((prev) => {
          if (prev.some(l => l.studentId === newLog.studentId && l.timestamp === newLog.timestamp)) {
            return prev;
          }
          const updated = [newLog, ...prev];
          saveAttendanceLogs(updated);
          return updated;
        });
      } else if (message.type === 'REQUEST_SESSION_STATE') {
        // Send all active sessions to student portal
        const currentSaved = getActiveSessions();
        postChannelMessage(channelRef.current, 'SESSIONS_UPDATE', currentSaved);
      } else if (message.type === 'SESSIONS_UPDATE') {
        if (Array.isArray(message.payload)) {
          setActiveSessions(message.payload);
          saveActiveSessions(message.payload);
        }
      } else if (message.type === 'FIREBASE_ERROR') {
        setFirebaseError(message.payload);
      }
    });

    return () => {
      if (channelRef.current) {
        channelRef.current.close();
      }
    };
  }, []);

  // Sync selectedSessionId if current list changes
  useEffect(() => {
    if (activeSessions.length > 0 && selectedSessionId !== 'all') {
      const exists = activeSessions.some(s => s.id === selectedSessionId);
      if (!exists) {
        setSelectedSessionId(activeSessions[0].id);
      }
    }
  }, [activeSessions, selectedSessionId]);

  // Generate dynamic QR token for a session
  const generateQRToken = (lectureData, sessionId) => {
    const header = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
    const payloadObj = {
      profName: lectureData.profName,
      lectureTitle: lectureData.lectureTitle,
      course: lectureData.course,
      sessionId: sessionId,
      timestamp: Date.now(),
      lat: profCoords?.lat ?? 30.0444,
      lng: profCoords?.lng ?? 31.2357,
    };
    const payload = btoa(unescape(encodeURIComponent(JSON.stringify(payloadObj)))).replace(/=/g, "");
    const sig = Array.from({ length: 30 }, () =>
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"[Math.floor(Math.random() * 64)]
    ).join("");
    return `${header}.${payload.substring(0, 20)}...${sig.substring(0, 10)}`;
  };

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
        setTimeout(() => resolve(null), 2000);
      } catch (err) {
        console.warn('WebRTC IP fetch error:', err);
        resolve(null);
      }
    });
  };

  const startNewLecture = async () => {
    try {
      setFirebaseError(null);
      const ip = await getLocalIP();
      const newSessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
      
      const newSession = {
        id: newSessionId,
        profName,
        department,
        lectureTitle,
        course,
        distanceLimit: Number(distanceLimit) || 5,
        lat: profCoords?.lat ?? 30.0444,
        lng: profCoords?.lng ?? 31.2357,
        ip,
        sessionActive: true,
        createdAt: Date.now(),
      };

      const token = generateQRToken(newSession, newSessionId);
      newSession.qrToken = token;

      const updatedSessions = [newSession, ...activeSessions];
      setActiveSessions(updatedSessions);
      setSelectedSessionId(newSessionId);
      saveActiveSessions(updatedSessions);

      await postChannelMessage(channelRef.current, 'SESSIONS_UPDATE', updatedSessions);
    } catch (err) {
      console.error(err);
      setFirebaseError(err.message);
    }
  };

  const stopLecture = async (sessionIdToStop) => {
    try {
      setFirebaseError(null);
      const updated = activeSessions.filter(s => s.id !== sessionIdToStop);
      setActiveSessions(updated);
      saveActiveSessions(updated);

      if (selectedSessionId === sessionIdToStop) {
        setSelectedSessionId(updated.length > 0 ? updated[0].id : 'all');
      }

      await postChannelMessage(channelRef.current, 'SESSIONS_UPDATE', updated);
    } catch (err) {
      console.error(err);
      setFirebaseError(err.message);
    }
  };

  const stopAllLectures = async () => {
    if (window.confirm('هل أنت متأكد من إنهاء جميع المحاضرات النشطة؟')) {
      try {
        setFirebaseError(null);
        setActiveSessions([]);
        setSelectedSessionId('all');
        saveActiveSessions([]);
        await postChannelMessage(channelRef.current, 'SESSIONS_UPDATE', []);
      } catch (err) {
        console.error(err);
        setFirebaseError(err.message);
      }
    }
  };

  const handleClearHistory = async () => {
    if (window.confirm('هل أنت متأكد من مسح جميع سجلات الحضور للجلسات الحالية من الخادم وقاعدة البيانات؟')) {
      await clearAllAttendanceLogs();
      setLogs([]);
    }
  };

  // Get active session object if selected
  const activeSelectedSession = activeSessions.find(s => s.id === selectedSessionId);

  // Filter logs by selected session or all
  const filteredLogs = logs.filter(log => {
    if (selectedSessionId === 'all') return true;
    if (log.sessionId) return log.sessionId === selectedSessionId;
    // Fallback match by course
    if (activeSelectedSession) {
      return log.course === activeSelectedSession.course || log.lectureTitle === activeSelectedSession.lectureTitle;
    }
    return true;
  });

  const getStats = (logList) => {
    const totalScans = logList.length;
    const verified = logList.filter(l => l.status === 'Attended').length;
    const rejected = logList.filter(l => l.status === 'Rejected').length;
    const rate = totalScans > 0 ? ((verified / totalScans) * 100).toFixed(1) : '100';
    return { totalScans, verified, rejected, rate };
  };

  const stats = getStats(filteredLogs);

  const exportToCSV = (statusFilter, filenamePrefix) => {
    const exportLogs = filteredLogs.filter(l => statusFilter === 'all' || (statusFilter === 'Attended' ? l.status === 'Attended' : l.status !== 'Attended'));
    if (exportLogs.length === 0) {
      alert('لا توجد بيانات متاحة للتصدير لهذه المحاضرة / الفئة');
      return;
    }

    const currentCourse = activeSelectedSession ? activeSelectedSession.course : 'جميع_المحاضرات';
    const headers = ['معرف المحاضرة', 'المادة / الكورس', 'معرف الطالب', 'اسم الطالب', 'البريد الجامعي', 'الحالة', 'سلامة الجهاز', 'فحص GPS', 'مطابقة الوجه', 'التاريخ والوقت'];
    const rows = exportLogs.map(log => [
      `"${log.sessionId || ''}"`,
      `"${log.course || log.lectureTitle || ''}"`,
      `"${log.studentId || ''}"`,
      `"${log.name || ''}"`,
      `"${log.email || ''}"`,
      `"${log.status === 'Attended' ? 'مقبول / حاضر' : 'مرفوض / مخالف'}"`,
      `"${log.integrity || ''}"`,
      `"${log.gps || ''}"`,
      `"${log.liveness || ''}"`,
      `"${log.timestamp ? new Date(log.timestamp).toLocaleString('ar-EG') : ''}"`
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${filenamePrefix}_${currentCourse}_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div>
      {firebaseError && (
        <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--danger)', color: 'var(--danger)', fontSize: '0.85rem', padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1.5rem', lineHeight: '1.4' }}>
          ⚠️ خطأ في المزامنة مع قاعدة بيانات Firebase: ({firebaseError}). يرجى التأكد من تفعيل Firestore Database وضبط القواعد (Rules) لتكون public.
        </div>
      )}

      {/* Active Lectures Selector Bar */}
      {activeSessions.length > 0 && (
        <div className="card" style={{ marginBottom: '1.5rem', background: 'rgba(99, 102, 241, 0.05)', border: '1px solid var(--accent)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <BookOpen style={{ color: 'var(--accent)' }} size={20} />
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>
                المحاضرات النشطة حالياً ({activeSessions.length})
              </h3>
            </div>
            <button 
              className="btn btn-secondary"
              onClick={stopAllLectures}
              style={{ background: 'var(--danger)', color: 'white', padding: '0.35rem 0.75rem', fontSize: '0.75rem' }}
            >
              <Square size={13} /> إغلاق جميع المحاضرات النشطة
            </button>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button 
              onClick={() => setSelectedSessionId('all')}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '8px',
                border: '1px solid ' + (selectedSessionId === 'all' ? 'var(--accent)' : 'var(--surface-border)'),
                background: selectedSessionId === 'all' ? 'var(--accent)' : 'rgba(255,255,255,0.03)',
                color: 'white',
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: '0.85rem'
              }}
            >
              🌐 عرض جميع المحاضرات ({logs.length} سجل)
            </button>

            {activeSessions.map((session) => {
              const sessionLogCount = logs.filter(l => l.sessionId === session.id || l.course === session.course).length;
              const isSelected = selectedSessionId === session.id;
              return (
                <div 
                  key={session.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.4rem 0.75rem',
                    borderRadius: '8px',
                    border: '1px solid ' + (isSelected ? 'var(--accent)' : 'var(--surface-border)'),
                    background: isSelected ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255,255,255,0.02)',
                    cursor: 'pointer'
                  }}
                  onClick={() => setSelectedSessionId(session.id)}
                >
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--success)' }}></span>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 800, color: isSelected ? 'white' : 'var(--fg)' }}>
                      {session.course}: {session.lectureTitle}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
                      المعلم: {session.profName} • ({sessionLogCount} حضور)
                    </div>
                  </div>
                  <button 
                    title="إغلاق هذه المحاضرة"
                    onClick={(e) => {
                      e.stopPropagation();
                      stopLecture(session.id);
                    }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--danger)',
                      cursor: 'pointer',
                      padding: '0.2rem',
                      display: 'flex',
                      alignItems: 'center'
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Stats Grid */}
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
        {/* Attendance Logs Table */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div>
              <h2 className="section-title" style={{ margin: 0 }}>سجل الحضور الأمني الفوري</h2>
              <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                {selectedSessionId === 'all' ? 'يعرض جميع المحاضرات النشطة والسابقة' : `مفلتر للمحاضرة: ${activeSelectedSession?.lectureTitle || selectedSessionId}`}
              </span>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button 
                className="btn btn-secondary" 
                onClick={() => exportToCSV('Attended', 'الطلاب_الحاضرون')}
                style={{ background: 'var(--success)', color: 'white', padding: '0.4rem 0.8rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
              >
                <Download size={14} /> تصدير الحاضرين ({activeSelectedSession ? activeSelectedSession.course : 'Excel'})
              </button>
              <button 
                className="btn btn-secondary" 
                onClick={() => exportToCSV('Rejected', 'الطلاب_المخالفون')}
                style={{ background: 'var(--warning, #eab308)', color: 'black', padding: '0.4rem 0.8rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem', fontWeight: 600 }}
              >
                <Download size={14} /> تصدير المخالفين ({activeSelectedSession ? activeSelectedSession.course : 'Excel'})
              </button>
              {logs.length > 0 && (
                <button 
                  className="btn btn-secondary" 
                  onClick={handleClearHistory} 
                  style={{ background: 'var(--danger)', color: 'white', padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                >
                  مسح السجلات
                </button>
              )}
            </div>
          </div>

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>المادة / الكورس</th>
                  <th>معرف الطالب</th>
                  <th>الاسم</th>
                  <th>البريد الجامعي</th>
                  <th>الحالة</th>
                  <th>سلامة الجهاز</th>
                  <th>فحص GPS</th>
                  <th>مطابقة الوجه</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan="8" style={{ textAlign: 'center', color: 'var(--muted)', padding: '2rem' }}>
                      {selectedSessionId === 'all' 
                        ? 'لا يوجد عمليات مسح مسجلة حالياً. قم ببدء محاضرة ودع الطلاب يمسحون الكود.'
                        : 'لا توجد عمليات مسح مسجلة لهذه المحاضرة المحددة حتى الآن.'
                      }
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map((log, index) => (
                    <tr key={index}>
                      <td style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent)' }}>
                        {log.course || log.lectureTitle || '-'}
                      </td>
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

        {/* Right Side: Create New Session & QR Code Display */}
        <div>
          {/* Lecture Creation Card */}
          <div className="card" style={{ marginBottom: '1.5rem' }}>
            <h3 className="section-title" style={{ fontSize: '1.1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Plus size={18} /> تفعيل محاضرة جديدة
            </h3>
            
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

            <button className="btn" style={{ width: '100%' }} onClick={startNewLecture}>
              <Play size={16} /> تفعيل وبث هذه المحاضرة الآن (QR جديد)
            </button>
          </div>

          {/* QR Code Display for Selected Active Session */}
          {activeSelectedSession ? (
            <div className="qr-container">
              <div style={{ background: 'rgba(99,102,241,0.1)', padding: '0.5rem 0.75rem', borderRadius: '8px', width: '100%', marginBottom: '0.75rem' }}>
                <span className="badge badge-success" style={{ marginBottom: '0.25rem' }}>محاضرة نشطة</span>
                <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800 }}>{activeSelectedSession.lectureTitle}</h4>
                <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                  كود المقرر: <strong>{activeSelectedSession.course}</strong> • المعلم: <strong>{activeSelectedSession.profName}</strong>
                </div>
              </div>

              <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.25rem' }}>رمز الـ QR الخاص بهذه المحاضرة</h3>
              <p style={{ fontSize: '0.7rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>مشفر بـ AES-256 وموقع بـ JWT ومستقل عن باقي المحاضرات</p>
              
              <div className="qr-code-box" style={{ width: '190px', height: '190px' }}>
                <QRCode
                  value={activeSelectedSession.qrToken}
                  size={190}
                  bgColor="var(--bg)"
                  fgColor="var(--accent)"
                  level="M"
                  includeMargin={false}
                />
              </div>

              <div style={{ width: '100%', maxWidth: '240px', marginTop: '0.75rem' }}>
                <div style={{ 
                  fontSize: '0.6rem', 
                  fontFamily: 'var(--font-mono)', 
                  color: 'var(--muted)', 
                  padding: '0.5rem', 
                  background: 'rgba(9, 10, 15, 0.6)', 
                  border: '1px solid var(--surface-border)', 
                  borderRadius: '8px', 
                  wordBreak: 'break-all',
                  textAlign: 'left'
                }}>
                  {activeSelectedSession.qrToken}
                </div>
              </div>

              <button 
                className="btn btn-danger" 
                style={{ width: '100%', marginTop: '1rem', fontSize: '0.8rem' }}
                onClick={() => stopLecture(activeSelectedSession.id)}
              >
                <Square size={14} /> إنهاء وتوقيف كود هذه المحاضرة
              </button>
            </div>
          ) : (
            <div className="card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>
              <BookOpen size={36} style={{ marginBottom: '0.5rem', opacity: 0.5 }} />
              <p style={{ fontSize: '0.85rem', margin: 0 }}>
                اختر محاضرة نشطة من الشريط أعلى الصفحة أو قم بتفعيل محاضرة جديدة لعرض الـ QR الخاص بها.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

