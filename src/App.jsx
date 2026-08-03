import React, { useState } from 'react';
import ProfessorPortal from './components/ProfessorPortal';
import StudentPortal from './components/StudentPortal';
import { ShieldAlert, BookOpen, User } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState('student'); // Default to student view for security

  const handleTabChange = (tab) => {
    if (tab === 'professor' || tab === 'demo') {
      const password = prompt('الرجاء إدخال رمز التحقق الخاص بالأستاذ:');
      if (password === '373911') {
        setActiveTab(tab);
      } else {
        alert('رمز الدخول خاطئ! هذه الصفحة مخصصة للمحاضرين فقط.');
      }
    } else {
      setActiveTab(tab);
    }
  };

  return (
    <div>
      <header>
        <div className="brand">
          <div className="brand-logo">U</div>
          <div className="brand-title">UAMS Portal</div>
        </div>
        <div className="system-status">
          <span className="status-dot"></span>
          التحقق آمن • حماية ضد التزوير نشطة
        </div>
      </header>

      <nav>
        <button 
          className={`nav-btn ${activeTab === 'demo' ? 'active' : ''}`} 
          onClick={() => handleTabChange('demo')}
        >
          عرض الواجهتين معاً (وضع المحاكاة)
        </button>
        <button 
          className={`nav-btn ${activeTab === 'professor' ? 'active' : ''}`} 
          onClick={() => handleTabChange('professor')}
        >
          لوحة الأستاذ (Professor Panel)
        </button>
        <button 
          className={`nav-btn ${activeTab === 'student' ? 'active' : ''}`} 
          onClick={() => handleTabChange('student')}
        >
          تطبيق الطالب المحمول (Student View)
        </button>
      </nav>

      <main>
        {activeTab === 'demo' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1fr', gap: '2rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                <BookOpen style={{ color: 'var(--accent)' }} />
                <h2 style={{ fontSize: '1.25rem', fontWeight: 800 }}>شاشة الأستاذ لوحدة التحكم وقاعة المحاضرة</h2>
              </div>
              <ProfessorPortal />
            </div>
            
            <div style={{ borderLeft: '1px solid var(--surface-border)', paddingLeft: '2rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
                <User style={{ color: 'var(--accent)' }} />
                <h2 style={{ fontSize: '1.25rem', fontWeight: 800 }}>تطبيق الطالب المحاكي</h2>
              </div>
              <StudentPortal />
            </div>
          </div>
        )}

        {activeTab === 'professor' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
              <BookOpen style={{ color: 'var(--accent)' }} />
              <h2 style={{ fontSize: '1.5rem', fontWeight: 800 }}>لوحة تحكم الأستاذ (بث المحاضرة وقبول الحضور)</h2>
            </div>
            <ProfessorPortal />
          </div>
        )}

        {activeTab === 'student' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
              <User style={{ color: 'var(--accent)' }} />
              <h2 style={{ fontSize: '1.5rem', fontWeight: 800 }}>تطبيق مسح وتسجيل الحضور الموثق للطالب</h2>
            </div>
            <StudentPortal />
          </div>
        )}
      </main>
    </div>
  );
}
