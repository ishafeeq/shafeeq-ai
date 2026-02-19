import React, { useState, useRef, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AuthModal } from './components/AuthModal';
import { Profile } from './pages/Profile';
import { Header, type Lang } from './components/Header';
import { ChatSidebar } from './components/ChatSidebar';
import { ConversationHistory } from './components/ConversationHistory';
import { StateBackground, ThinkingTextOverlay } from './components/StateBackgrounds';
import { useChat } from './hooks/useChat';
import { WavRecorder } from './utils/WavRecorder';
import { Mic, Square, Menu } from 'lucide-react';

// ─── Voice state machine ──────────────────────────────────────────────────────
type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking';

// ─── Status labels ────────────────────────────────────────────────────────────
const STATUS: Record<Lang, Record<VoiceState, string>> = {
  hi: {
    idle:      'बोलिए...',
    listening: 'सुन रहा हूँ...',
    thinking:  'सोच रहा हूँ...',
    speaking:  'बोल रहा हूँ...',
  },
  en: {
    idle:      'Tap to speak',
    listening: 'Listening...',
    thinking:  'Thinking...',
    speaking:  'Speaking...',
  },
};

// ─── Main Screen ──────────────────────────────────────────────────────────────
const BolAIScreen: React.FC = () => {
  const { user } = useAuth();
  const { messages, setMessages, sendAudio, isProcessing, processingStep } = useChat();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [lang, setLang] = useState<Lang>('hi');
  const [isRecording, setIsRecording] = useState(false);
  const [volume, setVolume] = useState(1);
  const [micVolume, setMicVolume] = useState(0);   // 0–1 from audio stream
  const [playingMsgId, setPlayingMsgId] = useState<number | null>(null);

  const wavRecorder = useRef<WavRecorder | null>(null);
  const audioPlayer  = useRef<HTMLAudioElement | null>(null);
  const analyserRef  = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);

  const langCode = lang === 'hi' ? 'hi-IN' : 'en-IN';

  // Derive single voice state
  const voiceState: VoiceState = isRecording
    ? 'listening'
    : isProcessing && processingStep.toLowerCase().includes('think')
    ? 'thinking'
    : isProcessing || playingMsgId !== null
    ? 'speaking'
    : 'idle';

  // Init audio player
  useEffect(() => {
    audioPlayer.current = new Audio();
    audioPlayer.current.onended = () => setPlayingMsgId(null);
    return () => { audioPlayer.current?.pause(); };
  }, []);

  // Sync volume
  useEffect(() => {
    if (audioPlayer.current) audioPlayer.current.volume = volume;
  }, [volume]);

  // Auto-play latest assistant message
  useEffect(() => {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role === 'assistant' && lastMsg.audio_url && playingMsgId === null) {
      playAudio(lastMsg.audio_url, lastMsg.id);
    }
  }, [messages]);

  // Haptic on thinking → speaking
  useEffect(() => {
    if (voiceState === 'speaking' && navigator.vibrate) navigator.vibrate([40, 20, 40]);
  }, [voiceState]);

  const playAudio = (url: string, msgId: number) => {
    if (!audioPlayer.current) return;
    if (playingMsgId === msgId) {
      if (audioPlayer.current.paused) audioPlayer.current.play();
      else { audioPlayer.current.pause(); setPlayingMsgId(null); }
      return;
    }
    // Always use a relative URL so it works from any device (mobile, desktop)
    // nginx proxies /uploads/ → FastAPI. Never use localhost here.
    const fullUrl = url.startsWith('http')
      ? url.replace(/^https?:\/\/[^/]+/, '')   // strip origin, keep path
      : `/${url.replace(/^\//, '')}`;           // ensure leading slash
    audioPlayer.current.src = fullUrl;
    audioPlayer.current.play().catch(console.error);
    setPlayingMsgId(msgId);
  };

  // Live mic volume via Web Audio API
  const startVolumeMonitor = (stream: MediaStream) => {
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    analyserRef.current = analyser;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      setMicVolume(Math.min(1, avg / 80));
      animFrameRef.current = requestAnimationFrame(tick);
    };
    tick();
  };

  const stopVolumeMonitor = () => {
    cancelAnimationFrame(animFrameRef.current);
    setMicVolume(0);
  };

  const handleMicPress = async () => {
    if (!user) { setShowAuthModal(true); return; }

    if (isRecording) {
      stopVolumeMonitor();
      if (wavRecorder.current) {
        const blob = await wavRecorder.current.stop();
        setIsRecording(false);
        await sendAudio(blob, langCode);
      }
    } else {
      audioPlayer.current?.pause();
      setPlayingMsgId(null);
      try {
        wavRecorder.current = new WavRecorder();
        const stream = await wavRecorder.current.start();
        if (stream) startVolumeMonitor(stream);
        setIsRecording(true);
        if (navigator.vibrate) navigator.vibrate(30);
      } catch {
        alert(lang === 'hi' ? 'माइक्रोफ़ोन एक्सेस नहीं मिली।' : 'Could not access microphone.');
      }
    }
  };

  const handleNewChat = () => {
    setMessages([]);
    audioPlayer.current?.pause();
    setPlayingMsgId(null);
  };

  const statusLabel = STATUS[lang][voiceState];

  return (
    <div
      className="w-full flex flex-col overflow-hidden relative"
      style={{ height: '100dvh', fontFamily: "'Inter', 'SF Pro Display', system-ui, sans-serif" }}
    >

      {/* ── Full-screen state-driven background ── */}
      <StateBackground voiceState={voiceState} volume={micVolume} />

      {/* ── Glassmorphism Header ── */}
      <div
        className="flex-shrink-0 relative z-20"
        style={{
          background: 'rgba(9,9,11,0.6)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
        }}
      >
        <div className="flex items-center px-4 h-14">
          {/* Sidebar toggle */}
          <button
            onClick={() => setShowSidebar(true)}
            className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/5 transition-colors mr-2"
          >
            <Menu size={20} />
          </button>

          {/* Logo */}
          <div className="flex items-center gap-2 flex-1">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)' }}
            >
              <span className="text-white text-xs font-black">B</span>
            </div>
            <span className="text-white font-bold text-base tracking-tight">Bol AI</span>
          </div>

          {/* Right controls */}
          <Header
            lang={lang}
            onLangToggle={() => setLang((l) => (l === 'hi' ? 'en' : 'hi'))}
            volume={volume}
            onVolumeChange={setVolume}
            onLoginClick={() => setShowAuthModal(true)}
          />
        </div>
      </div>

      {/* ── Main: Conversation History ── */}
      <main className="flex-1 relative z-10 overflow-hidden flex flex-col">
        <ConversationHistory
          messages={messages}
          playingMsgId={playingMsgId}
          onPlayAudio={playAudio}
        />
      </main>

      {/* ── Thinking text overlay: typewriter just above footer ── */}
      <ThinkingTextOverlay active={voiceState === 'thinking'} />

      {/* ── Glassmorphism Footer with Floating Mic ── */}
      <div
        className="flex-shrink-0 relative z-20"
        style={{
          background: 'rgba(9,9,11,0.7)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderTop: '1px solid rgba(255,255,255,0.05)',
          paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 24px)',
          minHeight: '160px',
        }}
      >
        <div className="flex flex-col items-center pt-5 pb-6 gap-3">
          {/* Status label */}
          <div
            className="text-xs font-medium tracking-wide transition-all duration-300"
            style={{
              color: voiceState === 'listening' ? '#60a5fa'
                   : voiceState === 'thinking'  ? '#c084fc'
                   : voiceState === 'speaking'  ? '#34d399'
                   : '#52525b',
            }}
          >
            {statusLabel}
          </div>

          {/* The GPT-OSS Core mic button */}
          <div className="relative flex items-center justify-center">
            {/* Outer pulse ring (listening only) */}
            {isRecording && (
              <>
                <div
                  className="absolute rounded-full border border-blue-500/30"
                  style={{
                    width: 100, height: 100,
                    animation: 'micPulse 1.5s ease-out infinite',
                  }}
                />
                <div
                  className="absolute rounded-full border border-blue-500/15"
                  style={{
                    width: 120, height: 120,
                    animation: 'micPulse 1.5s ease-out infinite 0.4s',
                  }}
                />
              </>
            )}

            {/* Speaking ripples */}
            {voiceState === 'speaking' && [1,2,3].map((i) => (
              <div
                key={i}
                className="absolute rounded-full border border-emerald-500/20"
                style={{
                  width: 80 + i * 20, height: 80 + i * 20,
                  animation: `micPulse ${1.8 + i * 0.3}s ease-out infinite ${i * 0.4}s`,
                }}
              />
            ))}

            {/* Main button */}
            <button
              onClick={handleMicPress}
              className="relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 select-none"
              style={{
                background: isRecording
                  ? 'linear-gradient(135deg, #dc2626, #ef4444)'
                  : voiceState === 'thinking'
                  ? 'linear-gradient(135deg, #5b21b6, #7c3aed)'
                  : voiceState === 'speaking'
                  ? 'linear-gradient(135deg, #065f46, #059669)'
                  : 'linear-gradient(135deg, #1d4ed8, #3b82f6)',
                border: `2px solid ${
                  isRecording ? 'rgba(239,68,68,0.5)'
                  : voiceState === 'thinking' ? 'rgba(139,92,246,0.5)'
                  : voiceState === 'speaking' ? 'rgba(16,185,129,0.5)'
                  : 'rgba(59,130,246,0.4)'
                }`,
                boxShadow: isRecording
                  ? '0 0 40px rgba(239,68,68,0.5), 0 8px 32px rgba(0,0,0,0.5)'
                  : voiceState === 'thinking'
                  ? '0 0 40px rgba(139,92,246,0.4), 0 8px 32px rgba(0,0,0,0.5)'
                  : voiceState === 'speaking'
                  ? '0 0 40px rgba(16,185,129,0.4), 0 8px 32px rgba(0,0,0,0.5)'
                  : '0 0 30px rgba(59,130,246,0.35), 0 8px 32px rgba(0,0,0,0.5)',
                animation: voiceState === 'idle' ? 'micBreath 3s ease-in-out infinite' : 'none',
              }}
            >
              {isRecording ? (
                <Square size={24} className="text-white" fill="white" />
              ) : (
                <Mic size={26} className="text-white" />
              )}
            </button>
          </div>

          {/* Mic volume bar (listening only) */}
          {isRecording && (
            <div className="flex items-center gap-1 h-4">
              {Array.from({ length: 12 }, (_, i) => (
                <div
                  key={i}
                  className="w-1 rounded-full transition-all duration-75"
                  style={{
                    height: micVolume > (i / 12) ? `${8 + Math.random() * 8}px` : '4px',
                    background: micVolume > (i / 12) ? '#3b82f6' : 'rgba(255,255,255,0.08)',
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Chat History Sidebar ── */}
      <ChatSidebar
        isOpen={showSidebar}
        onClose={() => setShowSidebar(false)}
        messages={messages}
        onNewChat={handleNewChat}
      />

      {/* Auth Modal */}
      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        @keyframes micPulse {
          0%   { transform: scale(1);   opacity: 0.6; }
          100% { transform: scale(1.8); opacity: 0; }
        }
        @keyframes micBreath {
          0%, 100% { transform: scale(1);    box-shadow: 0 0 30px rgba(59,130,246,0.35), 0 8px 32px rgba(0,0,0,0.5); }
          50%       { transform: scale(1.06); box-shadow: 0 0 50px rgba(59,130,246,0.6),  0 8px 32px rgba(0,0,0,0.5); }
        }
      `}</style>
    </div>
  );
};

// ─── App Root ─────────────────────────────────────────────────────────────────
function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/"        element={<BolAIScreen />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="*"        element={<Navigate to="/" />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
