import React, { useEffect, useRef } from 'react';
import { Play, Pause, Volume2, CreditCard } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { Message } from '../api/chat';

interface ConversationHistoryProps {
  messages: Message[];
  playingMsgId: number | null;
  onPlayAudio: (url: string, id: number) => void;
  isTyping?: boolean;
}

const parseContent = (content: string) => {
  const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
  const thinkingProcess = thinkMatch ? thinkMatch[1].trim() : null;
  const finalAnswer = content.replace(/<think>[\s\S]*?<\/think>/, '').trim();
  return { thinkingProcess, finalAnswer };
};

export const ConversationHistory: React.FC<ConversationHistoryProps> = ({
  messages,
  playingMsgId,
  onPlayAudio,
  isTyping,
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 pb-32">
        <p className="text-zinc-500 text-sm max-w-sm text-center leading-relaxed">
          Main Nisha hoon, aapki AI dost. Hindi ho ya English, mujhse aap apni natural language mein baat kar sakte hain. Bas mic button daba ke rakhiye aur boliye!
        </p>
        <div className="flex flex-wrap gap-2 justify-center">
          {['🎙️ Hinglish', '🔍 Web Search', '🧠 RAG', '🔊 Voice Reply'].map((f) => (
            <span
              key={f}
              className="text-xs px-3 py-1 rounded-full text-zinc-400"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
            >
              {f}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 pt-4 pb-36 space-y-4 scroll-smooth">
      {messages.map((msg, idx) => {
        const { thinkingProcess, finalAnswer } = parseContent(msg.content);
        const isUser = msg.role === 'user';
        const isVoice = isUser && (msg.is_voice || !!msg.translit_text);
        const isLastMessage = idx === messages.length - 1;
        const showCursor = isLastMessage && !isUser && isTyping;

        return (
          <div
            key={idx}
            className="flex"
            style={{ justifyContent: isUser ? 'flex-end' : 'flex-start' }}
          >
            {/* Assistant avatar */}
            {!isUser && (
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mr-2.5 mt-1"
                style={{ background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)' }}
              >
                <span className="text-white text-xs font-bold">B</span>
              </div>
            )}

            <div
              className="max-w-[90%] rounded-3xl px-8 py-6 relative"
              style={
                isUser
                  ? {
                      background: 'linear-gradient(135deg, #1d4ed8, #2563eb)',
                      borderRadius: '18px 18px 4px 18px',
                      boxShadow: '0 4px 20px rgba(37,99,235,0.3)',
                    }
                  : {
                      background: 'rgba(24,24,27,0.85)',
                      border: '1px solid rgba(255,255,255,0.07)',
                      borderRadius: '18px 18px 18px 4px',
                      backdropFilter: 'blur(12px)',
                    }
              }
            >
              {/* Thinking process collapsible */}
              {thinkingProcess && (
                <details className="mb-2.5">
                  <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-300 select-none flex items-center gap-1">
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-purple-500"
                      style={{ animation: 'pulse 1.5s ease-in-out infinite' }}
                    />
                    Thinking Process
                  </summary>
                  <div className="text-xs text-zinc-600 italic mt-1.5 border-l-2 border-zinc-700 pl-2.5 py-1 leading-relaxed">
                    {thinkingProcess.slice(0, 300)}…
                  </div>
                </details>
              )}

              {/* Audio play button for assistant and user (Moved to Top) */}
              {(!isUser || isVoice) && (
                <button
                  onClick={() => msg.audio_url ? onPlayAudio(msg.audio_url, msg.id) : undefined}
                  disabled={!msg.audio_url}
                  className={`mb-4 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full transition-all duration-200 ${!msg.audio_url ? 'opacity-50 cursor-not-allowed' : ''}`}
                  style={
                    playingMsgId === msg.id && msg.audio_url
                      ? { background: 'rgba(52,211,153,0.15)', color: '#34d399', border: '1px solid rgba(52,211,153,0.25)' }
                      : { background: 'rgba(255,255,255,0.05)', color: '#71717a', border: '1px solid rgba(255,255,255,0.08)' }
                  }
                >
                  {playingMsgId === msg.id ? <Pause size={11} /> : <Play size={11} />}
                  <Volume2 size={11} />
                  {playingMsgId === msg.id ? 'Pause' : 'Play'}
                </button>
              )}

              {/* Voice message: Hinglish main + English italic */}
              {isVoice ? (
                <div>
                  <p className="text-white text-xl leading-relaxed font-medium min-h-[1.75rem]">
                    {msg.translit_text || '\u00A0'}
                  </p>
                  <p className="text-blue-200/60 text-sm italic mt-3 leading-relaxed min-h-[1.25rem]">
                    {msg.content || '\u00A0'}
                  </p>
                </div>
              ) : (
                <div>
                  <p
                    className="text-xl leading-relaxed whitespace-pre-wrap inline-block"
                    style={{ color: isUser ? '#fff' : '#d4d4d8' }}
                  >
                    {finalAnswer || msg.content}
                    {showCursor && (
                      <span className="ml-[2px] mb-[-2px] inline-block w-2h-5 bg-blue-400 animate-pulse" style={{ height: '1.2em', width: '0.4em', verticalAlign: 'middle' }} />
                    )}
                  </p>
                  {(finalAnswer || msg.content).includes('Insufficient credits') && (
                    <button
                      onClick={() => navigate('/profile')}
                      className="mt-4 flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                    >
                      <CreditCard size={16} />
                      Buy Credits
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
};
