import React, { useState, useRef, useEffect, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, Link } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AuthModal } from './components/AuthModal';
import { Profile } from './pages/Profile';
import { Header, type Lang } from './components/Header';
import { ChatSidebar } from './components/ChatSidebar';
import { ConversationHistory } from './components/ConversationHistory';
import { StateBackground } from './components/StateBackgrounds';
import { useChat } from './hooks/useChat';
import { WavRecorder } from './utils/WavRecorder';
import { Loader2, Menu, Mic, Square } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Voice state machine ──────────────────────────────────────────────────────
type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking';

// ─── Status labels ────────────────────────────────────────────────────────────
const STATUS: Record<Lang, Record<VoiceState, string>> = {
  'hi-en': {
    idle:      'Baat karne ke liye button ko daba ke rakhen',
    listening: 'Sun rahi hun',
    thinking:  'Soch rahi hun',
    speaking:  'Bol rahi hun',
  },
  en: {
    idle:      'Tap to speak',
    listening: 'Listening...',
    thinking:  'Thinking...',
    speaking:  'Speaking...',
  },
};

// ─── Main Screen ──────────────────────────────────────────────────────────────
interface SAIScreenProps {
  lang: Lang;
  showSidebar: boolean;
  setShowSidebar: (v: boolean) => void;
  setShowAuthModal: (v: boolean) => void;
}

const SAIScreen = ({ lang, showSidebar, setShowSidebar, setShowAuthModal }: SAIScreenProps) => {
  const { user } = useAuth();
  const { 
    messages, 
    setMessages, 
    sendAudio, 
    isProcessing, 
    processingStep,
    conversations,
    loadConversation,
    conversationId,
    setConversationId
  } = useChat();

  const [isRecording, setIsRecording] = useState(false);
  const [micVolume, setMicVolume] = useState(0);   // 0–1 from audio stream
  const [playingMsgId, setPlayingMsgId] = useState<number | null>(null);

  // Audio state
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [isAudioPlaying] = useState(false);
  const isRecordingRef = useRef(false);
  
  // Recording timer state
  const [recordingTimeLeft, setRecordingTimeLeft] = useState(30);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const wavRecorder = useRef<WavRecorder | null>(null);
  const audioPlayer  = useRef<HTMLAudioElement | null>(null);
  const analyserRef  = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const lastPlayedMsgRef = useRef<number | null>(null);

  const langCode = lang === 'hi-en' ? 'hi-IN' : 'en-IN';

  // Derive single voice state (This logic is now replaced by the explicit `voiceState` state)
  // const voiceState: VoiceState = isRecording
  //   ? 'listening'
  //   : isProcessing && processingStep.toLowerCase().includes('think')
  //   ? 'thinking'
  //   : isProcessing || playingMsgId !== null
  //   ? 'speaking'
  //   : 'idle';

  // Init audio player
  useEffect(() => {
    audioPlayer.current = new Audio();
    audioPlayer.current.onended = () => setPlayingMsgId(null);
    return () => { audioPlayer.current?.pause(); };
  }, []);

  // No volume sync needed since volume was removed

  const playAudio = useCallback((url: string, msgId: number) => {
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
      
    // Force reset the audio element before applying new source
    audioPlayer.current.pause();
    audioPlayer.current.loop = false;
    audioPlayer.current.src = fullUrl;
    audioPlayer.current.load();
    
    const playPromise = audioPlayer.current.play();
    if (playPromise !== undefined) {
      playPromise.catch((e) => {
        console.error("Audio playback locked by browser policy:", e);
      });
    }
    setPlayingMsgId(msgId);
  }, [playingMsgId]);

  // Auto-play the oldest unplayed message audio 
  // (Prevents skipping the User message when Assistant box spawns instantly)
  useEffect(() => {
    if (messages.length === 0) return;
    
    // Find the first message that has audio and hasn't been completely played
    const unplayedMsg = messages.find(m => 
      m.audio_url && 
      m.id !== lastPlayedMsgRef.current && 
      m.id > (lastPlayedMsgRef.current || 0)
    );

    if (!unplayedMsg) return;

    if (unplayedMsg.role === 'user') {
      lastPlayedMsgRef.current = unplayedMsg.id;
      playAudio(unplayedMsg.audio_url!, unplayedMsg.id);
    } else if (unplayedMsg.role === 'assistant') {
      lastPlayedMsgRef.current = unplayedMsg.id;
      playAudio(unplayedMsg.audio_url!, unplayedMsg.id);
    }
  }, [messages, playAudio]);

  // Haptic on thinking → speaking
  useEffect(() => {
    if (voiceState === 'speaking' && navigator.vibrate) navigator.vibrate([40, 20, 40]);
  }, [voiceState]);

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

  // Handle stopping the recording timer
  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRecordingTimeLeft(30); // Reset for next time
  }, []);

  const stopRecording = useCallback(async (e?: Event | React.SyntheticEvent) => {
    e?.preventDefault();
    if (!isRecordingRef.current) return;
    
    isRecordingRef.current = false;
    stopVolumeMonitor();
    stopTimer();
    if (wavRecorder.current) {
      const { blob, duration } = await wavRecorder.current.stop();
      setIsRecording(false);
      setVoiceState('idle'); 
      
      // Unlock Safari/iOS audio context synchronously on user interaction
      if (audioPlayer.current) {
        audioPlayer.current.loop = true;
        audioPlayer.current.src = "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU5LjE2LjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXVqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv//////////////////////////////////////////////////AAAAAExhdmM1OS4xOAAAAAAAAAAAAAAAAQAkBIKDAAAEAQAAASCG4/h1AAAAAAAAAAAAAAAAAAAA//MUZAAAAAGkAAAAAAAAA0gAAAAATEFN//MUZAMAAAGkAAAAAAAAA0gAAAAARTMu//MUZAYAAAGkAAAAAAAAA0gAAAAAOTku//MUZAgAAAGkAAAAAAAAA0gAAAAANVVV";
        audioPlayer.current.play().catch(() => {});
      }
      
      await sendAudio(blob, duration, langCode);
    }
  }, [langCode, sendAudio, stopTimer]);

  // Set up the recording timer effect
  useEffect(() => {
    if (isRecording) {
      setRecordingTimeLeft(30);
      timerRef.current = setInterval(() => {
        setRecordingTimeLeft((prev: number) => prev - 1);
      }, 1000);
    } else {
      stopTimer();
    }
    
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isRecording, stopTimer]);

  useEffect(() => {
    if (isRecording && recordingTimeLeft <= 0) {
      stopRecording();
    }
  }, [recordingTimeLeft, isRecording, stopRecording]);

  const startRecording = useCallback(async (e?: Event | React.SyntheticEvent) => {
    e?.preventDefault();
    if (!user) { setShowAuthModal(true); return; }
    if (isRecordingRef.current || isProcessing) return;

    audioPlayer.current?.pause();
    setPlayingMsgId(null);
    try {
      wavRecorder.current = new WavRecorder();
      const stream = await wavRecorder.current.start();
      if (stream) startVolumeMonitor(stream);
      isRecordingRef.current = true;
      setIsRecording(true);
      setVoiceState('listening'); 
      if (navigator.vibrate) navigator.vibrate(30);
    } catch {
      alert(lang === 'hi-en' ? 'Microphone access nahi mili.' : 'Could not access microphone.');
    }
  }, [user, lang]);

  // Global spacebar logic
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        startRecording(e);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        stopRecording(e);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [startRecording, stopRecording]);

  // Global Audio Event Interceptors for LLM Stream integration
  useEffect(() => {
    const handleStopAudio = () => {
      audioPlayer.current?.pause();
      setPlayingMsgId(null);
    };
    const handlePlayAiAudio = (e: Event) => {
      const customEvent = e as CustomEvent;
      playAudio(customEvent.detail.url, customEvent.detail.msgId);
    };

    window.addEventListener('stopAudio', handleStopAudio);
    window.addEventListener('playAiAudio', handlePlayAiAudio);
    return () => {
      window.removeEventListener('stopAudio', handleStopAudio);
      window.removeEventListener('playAiAudio', handlePlayAiAudio);
    };
  }, [playAudio]);

  // Update voiceState based on isProcessing and playingMsgId
  useEffect(() => {
    if (isRecording) {
      setVoiceState('listening');
    } else if (playingMsgId !== null) {
      setVoiceState('speaking');
    } else if (isProcessing) {
      // Differentiate between user playing and backend generating
      const playingUserMsg = messages.find(m => m.id === playingMsgId && m.role === 'user');
      if (playingUserMsg) {
          setVoiceState('speaking');
      } else {
          setVoiceState('thinking');
      }
    } else {
      setVoiceState('idle');
    }
  }, [isRecording, isProcessing, playingMsgId, messages]);


  const handleNewChat = () => {
    setConversationId(null);
    setMessages([]);
    audioPlayer.current?.pause();
    setPlayingMsgId(null);
    setShowSidebar(false);
  };

  // const statusLabel = STATUS[lang][voiceState];

  return (
    <div
      className="w-full flex-1 flex flex-col overflow-hidden relative"
    >

      {/* ── Full-screen state-driven background ── */}
      <StateBackground voiceState={voiceState} volume={micVolume} />

      {/* ── Main: Conversation History ── */}
      <main className="flex-1 relative z-10 overflow-hidden flex flex-col">
        <ConversationHistory
          messages={messages}
          playingMsgId={playingMsgId}
          onPlayAudio={playAudio}
          isTyping={isProcessing && processingStep === 'Typing...'}
        />
      </main>

      {/* ── Glassmorphism Footer with Floating Mic ── */}
      <div
        className="flex-shrink-0 relative z-20"
        style={{
          background: 'rgba(9,9,11,0.7)',
          borderTop: '1px solid rgba(255,255,255,0.05)',
          paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 16px)',
          minHeight: '100px',
        }}
      >
        <div className="flex flex-col items-center pt-3 pb-4 gap-2">
          {/* Status label */}
          <div className="flex h-20 flex-col items-center justify-center p-4 text-center relative z-10">
            {voiceState === 'speaking' && !isAudioPlaying ? (
              <div className="flex flex-col items-center gap-4">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
                <p className="text-xl font-medium text-zinc-400">
                  {STATUS[lang as Lang][voiceState as VoiceState]}
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <p className={`text-xl font-medium transition-colors duration-300 ${
                  voiceState === 'listening' ? 'text-green-500' : 'text-zinc-400'
                }`}>
                  {STATUS[lang as Lang][voiceState as VoiceState]}
                </p>
                
                <AnimatePresence>
                  {voiceState === 'listening' && (
                    <motion.div 
                      initial={{ opacity: 0, height: 0, y: -10 }}
                      animate={{ opacity: 1, height: 'auto', y: 0 }}
                      exit={{ opacity: 0, height: 0, y: -10 }}
                      className="mt-2 text-sm font-semibold tracking-wide"
                    >
                      <span className={recordingTimeLeft <= 10 ? 'text-red-500 animate-pulse' : 'text-green-600/80'}>
                        {recordingTimeLeft}s remaining
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
            {/* {error && (
              <div className="mt-4 flex items-center gap-2 text-red-500">
                <AlertCircle size={18} />
                <span>{error}</span>
              </div>
            )} */}
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
              disabled={isProcessing}
              onMouseDown={isProcessing ? undefined : startRecording}
              onMouseUp={isProcessing ? undefined : stopRecording}
              onMouseLeave={isProcessing ? undefined : stopRecording}
              onTouchStart={isProcessing ? undefined : startRecording}
              onTouchEnd={isProcessing ? undefined : stopRecording}
              className={`relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 select-none ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}`}
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
        onNewChat={handleNewChat}
        conversations={conversations}
        currentConversationId={conversationId}
        onSelectConversation={(id: number) => {
          loadConversation(id);
          setShowSidebar(false);
        }}
      />

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
function AppContent() {
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [lang, setLang] = useState<Lang>('hi-en');
  const location = useLocation();

  return (
    <div
      className="w-full flex flex-col overflow-hidden relative bg-[#09090b]"
      style={{ height: '100dvh', fontFamily: "'Inter', 'SF Pro Display', system-ui, sans-serif" }}
    >
      {/* ── Persistent Glassmorphism Header ── */}
      <div
        className="flex-shrink-0 relative z-50"
        style={{
          background: 'rgba(9,9,11,0.6)',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
        }}
      >
        <div className="flex items-center px-4 h-14">
          {/* Sidebar toggle (only on home logic) */}
          {location.pathname === '/' ? (
            <button
              onClick={() => setShowSidebar(true)}
              className="p-2 -ml-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/5 transition-colors mr-1 sm:mr-2"
            >
              <Menu size={20} />
            </button>
          ) : (
             <div className="w-8 sm:w-10"></div>
          )}

          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 flex-1 justify-start">
            <img 
              src="/SAI-Logo.webp" 
              alt="SAI Logo" 
              className="w-8 h-8 rounded-lg object-contain bg-black/20"
            />
            <span className="text-white font-bold text-base tracking-tight">SAI</span>
          </Link>

          {/* Right controls */}
          <Header
            lang={lang}
            onLangToggle={() => setLang((l: Lang) => (l === 'hi-en' ? 'en' : 'hi-en'))}
            onLoginClick={() => setShowAuthModal(true)}
          />
        </div>
      </div>

      <Routes>
        <Route path="/" element={<SAIScreen lang={lang} showSidebar={showSidebar} setShowSidebar={setShowSidebar} setShowAuthModal={setShowAuthModal} />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>

      {/* Global Auth Modal */}
      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <AppContent />
      </Router>
    </AuthProvider>
  );
}

export default App;
