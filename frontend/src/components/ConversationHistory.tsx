import React, { useEffect, useRef } from 'react';
import { Play, Pause, Volume2 } from 'lucide-react';
import type { Message } from '../api/chat';

interface ConversationHistoryProps {
  messages: Message[];
  playingMsgId: number | null;
  onPlayAudio: (url: string, id: number) => void;
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
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 pb-32">
        <p className="text-zinc-500 text-sm max-w-xs text-center leading-relaxed">
          Press the mic button below and speak in Hindi, English, or Hinglish
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
        const isVoice = isUser && !!msg.translit_text;

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
              className="max-w-[78%] rounded-2xl px-5 py-3.5 relative"
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

              {/* Voice message: Hinglish main + English italic */}
              {isVoice ? (
                <div>
                  <p className="text-white text-sm leading-relaxed font-medium">
                    {msg.translit_text}
                  </p>
                  <p className="text-blue-200/60 text-xs italic mt-1 leading-relaxed">
                    {msg.content}
                  </p>
                </div>
              ) : (
                <p
                  className="text-sm leading-relaxed whitespace-pre-wrap"
                  style={{ color: isUser ? '#fff' : '#d4d4d8' }}
                >
                  {finalAnswer || msg.content}
                </p>
              )}

              {/* Audio play button for assistant */}
              {!isUser && msg.audio_url && (
                <button
                  onClick={() => onPlayAudio(msg.audio_url!, msg.id)}
                  className="mt-2.5 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full transition-all duration-200"
                  style={
                    playingMsgId === msg.id
                      ? { background: 'rgba(52,211,153,0.15)', color: '#34d399', border: '1px solid rgba(52,211,153,0.25)' }
                      : { background: 'rgba(255,255,255,0.05)', color: '#71717a', border: '1px solid rgba(255,255,255,0.08)' }
                  }
                >
                  {playingMsgId === msg.id ? <Pause size={11} /> : <Play size={11} />}
                  <Volume2 size={11} />
                  {playingMsgId === msg.id ? 'Pause' : 'Play'}
                </button>
              )}
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
};
