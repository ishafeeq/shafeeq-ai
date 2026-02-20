import React, { useEffect, useRef } from 'react';
import { X, MessageSquare, Plus, Clock } from 'lucide-react';
import type { Message } from '../api/chat';

interface ChatSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  messages: Message[];
  onNewChat: () => void;
}

export const ChatSidebar: React.FC<ChatSidebarProps> = ({
  isOpen,
  onClose,
  messages,
  onNewChat,
}) => {
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    if (isOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, onClose]);

  // Group messages into a single "current conversation" preview
  const userMessages = messages.filter((m) => m.role === 'user');
  const preview = userMessages[0]?.content?.slice(0, 50) || 'New conversation';

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-300"
        style={{ opacity: isOpen ? 1 : 0, pointerEvents: isOpen ? 'auto' : 'none' }}
        onClick={onClose}
      />

      {/* Sidebar panel */}
      <div
        ref={ref}
        className="fixed top-0 left-0 h-full z-50 flex flex-col"
        style={{
          width: 280,
          background: 'rgba(9, 9, 11, 0.95)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderRight: '1px solid rgba(59,130,246,0.12)',
          transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          boxShadow: isOpen ? '4px 0 40px rgba(0,0,0,0.6)' : 'none',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div className="flex items-center gap-2">
            <MessageSquare size={16} className="text-blue-400" />
            <span className="text-white font-semibold text-sm tracking-wide">Chat History</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-white/5 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* New Chat Button */}
        <div className="px-4 pt-4 pb-2">
          <button
            onClick={() => { onNewChat(); onClose(); }}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200"
            style={{
              background: 'rgba(59,130,246,0.12)',
              border: '1px solid rgba(59,130,246,0.2)',
              color: '#93c5fd',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(59,130,246,0.2)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(59,130,246,0.12)';
            }}
          >
            <Plus size={15} />
            New Conversation
          </button>
        </div>

        {/* Conversations list */}
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
          <p className="text-zinc-600 text-xs uppercase tracking-widest px-2 py-1 font-medium">Today</p>

          {messages.length > 0 ? (
            <button
              className="w-full text-left px-3 py-3 rounded-xl transition-all duration-150 group"
              style={{
                background: 'rgba(59,130,246,0.08)',
                border: '1px solid rgba(59,130,246,0.15)',
              }}
            >
              <div className="flex items-start gap-2.5">
                <div
                  className="mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: 'rgba(59,130,246,0.15)' }}
                >
                  <MessageSquare size={13} className="text-blue-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-zinc-200 text-xs font-medium truncate">{preview}…</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <Clock size={10} className="text-zinc-600" />
                    <span className="text-zinc-600 text-xs">{messages.length} messages</span>
                  </div>
                </div>
              </div>
            </button>
          ) : (
            <div className="text-center py-12">
              <MessageSquare size={28} className="text-zinc-700 mx-auto mb-3" />
              <p className="text-zinc-600 text-xs">No conversations yet</p>
              <p className="text-zinc-700 text-xs mt-1">Start speaking to begin</p>
            </div>
          )}
        </div>

        {/* Footer branding */}
        <div
          className="px-5 py-4"
          style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}
        >
          <div className="flex items-center gap-2">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)' }}
            >
              <span className="text-white text-xs font-bold">B</span>
            </div>
            <div>
              <p className="text-white text-xs font-semibold">Bol AI</p>
              <p className="text-zinc-600 text-xs">GPT-OSS Core</p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
