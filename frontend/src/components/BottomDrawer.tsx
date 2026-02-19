import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronUp, ChevronDown, MessageSquare, Play, Pause } from 'lucide-react';
import type { Message } from '../api/chat';

interface BottomDrawerProps {
  messages: Message[];
  playingMsgId: number | null;
  onPlayAudio: (url: string, id: number) => void;
}

export const BottomDrawer: React.FC<BottomDrawerProps> = ({
  messages,
  playingMsgId,
  onPlayAudio,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const parseContent = (content: string) => {
    const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
    const thinkingProcess = thinkMatch ? thinkMatch[1].trim() : null;
    const finalAnswer = content.replace(/<think>[\s\S]*?<\/think>/, '').trim();
    return { thinkingProcess, finalAnswer };
  };

  return (
    <>
      {/* Handle */}
      <AnimatePresence>
        {!isOpen && (
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            className="fixed bottom-0 left-0 right-0 z-40 bg-zinc-900/90 backdrop-blur-md border-t border-zinc-800 rounded-t-3xl p-4 cursor-pointer flex flex-col items-center gap-2"
            onClick={() => setIsOpen(true)}
          >
            <div className="w-10 h-1 bg-zinc-700 rounded-full" />
            <div className="flex items-center gap-2 text-zinc-500 text-sm">
              <MessageSquare size={14} />
              <span>{messages.length > 0 ? `${messages.length} messages` : 'Chat History'}</span>
              <ChevronUp size={14} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Full Drawer */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: '0%' }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 220 }}
            className="fixed inset-0 z-50 bg-[#09090b] flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-md">
              <h2 className="text-lg font-semibold text-white">Conversation</h2>
              <button
                onClick={() => setIsOpen(false)}
                className="p-2 rounded-full bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
              >
                <ChevronDown size={20} />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-8">
              {messages.length === 0 && (
                <div className="text-center text-zinc-600 mt-20 text-sm">
                  No messages yet. Start speaking!
                </div>
              )}
              {messages.map((msg, idx) => {
                const { thinkingProcess, finalAnswer } = parseContent(msg.content);
                return (
                  <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[85%] rounded-2xl px-5 py-3.5 ${
                        msg.role === 'user'
                          ? 'bg-blue-600 text-white rounded-br-sm'
                          : 'bg-zinc-900 text-zinc-200 border border-zinc-800 rounded-bl-sm'
                      }`}
                    >
                      {thinkingProcess && (
                        <details className="mb-2">
                          <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-300 select-none">
                            Thinking Process
                          </summary>
                          <div className="text-xs text-zinc-600 italic mt-1 border-l-2 border-zinc-700 pl-2 py-1">
                            {thinkingProcess}
                          </div>
                        </details>
                      )}

                      <p className="whitespace-pre-wrap text-sm leading-relaxed">{finalAnswer || msg.content}</p>

                      {msg.role === 'assistant' && msg.audio_url && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onPlayAudio(msg.audio_url!, msg.id);
                          }}
                          className={`mt-2.5 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full transition-colors ${
                            playingMsgId === msg.id
                              ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                              : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'
                          }`}
                        >
                          {playingMsgId === msg.id ? <Pause size={12} /> : <Play size={12} />}
                          {playingMsgId === msg.id ? 'Pause' : 'Play'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
