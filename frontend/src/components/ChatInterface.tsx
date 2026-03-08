import React, { useState, useRef, useEffect } from 'react';
import { Mic, Paperclip, Send, X, Loader2, Keyboard, Volume2, Play, Pause } from 'lucide-react';
import { useChat } from '../hooks/useChat';
import { WavRecorder } from '../utils/WavRecorder';

interface ChatInterfaceProps {
  onClose: () => void;
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({ onClose }) => {
  const { messages, setMessages, sendMessage, sendAudio, isProcessing, processingStep } = useChat();
  const [input, setInput] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [inputType, setInputType] = useState<'audio' | 'text'>('audio');
  const [volume, setVolume] = useState(1);
  const [playingMsgId, setPlayingMsgId] = useState<number | null>(null);
  
  const wavRecorder = useRef<WavRecorder | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioPlayer = useRef<HTMLAudioElement | null>(null);
  const lastPlayedMsgRef = useRef<number | null>(null);

  // Initialize audio player
  useEffect(() => {
    audioPlayer.current = new Audio();
    audioPlayer.current.onended = () => setPlayingMsgId(null);
    return () => {
        if (audioPlayer.current) {
            audioPlayer.current.pause();
            audioPlayer.current = null;
        }
    };
  }, []);

  // Update volume
  useEffect(() => {
    if (audioPlayer.current) {
        audioPlayer.current.volume = volume;
    }
  }, [volume]);

  // Auto-play new assistant messages
  useEffect(() => {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.role === 'assistant' && lastMsg.audio_url && !playingMsgId && lastMsg.id !== lastPlayedMsgRef.current) {
        lastPlayedMsgRef.current = lastMsg.id;
        playAudio(lastMsg.audio_url, lastMsg.id);
    }
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isProcessing, playingMsgId]);


  const playAudio = (url: string, msgId: number) => {
      if (!audioPlayer.current) return;

      // If clicking same message, toggle pause/play
      if (playingMsgId === msgId) {
          if (audioPlayer.current.paused) {
              audioPlayer.current.play();
          } else {
              audioPlayer.current.pause();
              setPlayingMsgId(null); 
          }
          return;
      }

      // Play new message
      const fullUrl = url.startsWith('http') ? url : `http://localhost:8000/${url}`;
      audioPlayer.current.src = fullUrl;
      audioPlayer.current.play().catch(e => console.error("Playback failed:", e));
      setPlayingMsgId(msgId);
  };

  const stopAudio = () => {
      if (audioPlayer.current) {
          audioPlayer.current.pause();
          setPlayingMsgId(null);
      }
  };

  const handleSend = async () => {
    if (!input.trim()) return;
    const tempContent = input;
    setInput('');
    
    // Add user message optimistically
    setMessages(prev => [...prev, { 
      id: Date.now(), 
      role: 'user', 
      content: tempContent, 
      created_at: new Date().toISOString() 
    }]);

    await sendMessage(tempContent);
  };

  const startRecording = async () => {
    if (isProcessing) return;
    stopAudio(); // Stop playback when recording starts
    try {
      wavRecorder.current = new WavRecorder();
      await wavRecorder.current.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Could not access microphone.");
    }
  };

  const stopRecording = async () => {
    if (wavRecorder.current && isRecording) {
      const { blob, duration } = await wavRecorder.current.stop();
      setIsRecording(false);
      await sendAudio(blob, duration);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-4 shadow-sm">
        <h2 className="text-xl font-semibold text-gray-800">Jeetu Chat</h2>
        
        {/* Volume Control */}
        <div className="flex items-center gap-2 bg-gray-100 rounded-full px-4 py-2">
            <Volume2 size={16} className="text-gray-500" />
            <input 
                type="range" 
                min="0" 
                max="1" 
                step="0.1" 
                value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="w-24 h-1 bg-gray-300 rounded-lg appearance-none cursor-pointer"
            />
        </div>

        <button onClick={onClose} className="rounded-full p-2 hover:bg-gray-100">
          <X size={24} className="text-gray-600" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {messages.length === 0 && (
           <div className="text-center text-gray-400 mt-20">
              <p>Start a conversation...</p>
           </div>
        )}
        {messages.map((msg, idx) => {
          // Parse content for <think> tags (assistant messages)
          const thinkMatch = msg.content.match(/<think>([\s\S]*?)<\/think>/);
          const thinkingProcess = thinkMatch ? thinkMatch[1].trim() : null;
          const finalAnswer = msg.content.replace(/<think>[\s\S]*?<\/think>/, '').trim();

          // For voice user messages: show Hinglish as main, English in italic below
          const isVoiceUserMsg = msg.role === 'user' && !!msg.translit_text;

          return (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-2xl px-6 py-4 shadow-sm relative group ${
                msg.role === 'user' 
                  ? 'bg-indigo-600 text-white rounded-br-none' 
                  : 'bg-white border border-gray-200 text-gray-800 rounded-bl-none'
              }`}>
                
                {/* Play/Pause Button (Top Right) */}
                 {msg.audio_url && msg.role === 'assistant' && (
                    <button 
                        onClick={() => playAudio(msg.audio_url!, msg.id)}
                        className="absolute -top-3 -right-3 bg-white border shadow-md rounded-full p-2 text-indigo-600 hover:bg-indigo-50 transition-transform hover:scale-110 z-10"
                    >
                        {playingMsgId === msg.id ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
                    </button>
                 )}

                {/* Thinking Process (Collapsible) */}
                {thinkingProcess && (
                  <details className="mb-4">
                    <summary className="cursor-pointer text-sm text-gray-500 font-medium hover:text-indigo-600">
                      Thinking Process
                    </summary>
                    <div className="mt-2 text-sm text-gray-600 border-l-2 border-gray-300 pl-3 italic bg-gray-50 p-2 rounded">
                      {thinkingProcess}
                    </div>
                  </details>
                )}

                {/* Voice user message: Hinglish main + English italic */}
                {isVoiceUserMsg ? (
                  <div>
                    <p className="whitespace-pre-wrap font-medium">{msg.translit_text}</p>
                    <p className="whitespace-pre-wrap text-sm mt-1 opacity-75 italic">{msg.content}</p>
                  </div>
                ) : (
                  /* Regular message or assistant */
                  <p className="whitespace-pre-wrap">{finalAnswer || msg.content}</p>
                )}
                
              </div>
            </div>
          );
        })}

        
        {isProcessing && (
           <div className="flex justify-start">
             <div className="bg-gray-100 rounded-2xl rounded-bl-none px-6 py-4 flex items-center gap-2 text-gray-500 text-sm">
                <Loader2 size={16} className="animate-spin" />
                <span>{processingStep}</span>
             </div>
           </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="border-t bg-gray-50 p-8">
        <div className="mx-auto max-w-2xl flex flex-col items-center gap-6">
            
            {inputType === 'audio' ? (
                // Audio First Mode
                <div className="flex items-center gap-8 w-full justify-center relative">
                     {/* Toggle to Text */}
                     <button 
                        onClick={() => setInputType('text')}
                        className="absolute left-4 p-3 rounded-full bg-gray-200 text-gray-600 hover:bg-gray-300 transition"
                        title="Switch to Keyboard"
                    >
                        <Keyboard size={20} />
                    </button>

                    {/* Big Mic Button */}
                    <button 
                        disabled={isProcessing}
                        onMouseDown={isProcessing ? undefined : startRecording}
                        onMouseUp={isProcessing ? undefined : stopRecording}
                        onMouseLeave={isProcessing ? undefined : stopRecording}
                        onTouchStart={isProcessing ? undefined : startRecording}
                        onTouchEnd={isProcessing ? undefined : stopRecording}
                        className={`rounded-full p-8 transition-all shadow-lg ${
                        isProcessing 
                            ? 'bg-gray-400 text-white shadow-none opacity-50 cursor-not-allowed'
                            : isRecording 
                            ? 'bg-red-500 text-white scale-125 shadow-red-300 animate-pulse' 
                            : 'bg-indigo-600 text-white hover:bg-indigo-700 hover:scale-110 shadow-indigo-300'
                        }`}
                        title="Hold to record"
                    >
                        <Mic size={40} />
                    </button>
                    
                    <p className={`absolute -bottom-8 text-sm font-medium transition-opacity ${isRecording ? "text-red-500 opacity-100" : "text-gray-400 opacity-50"}`}>
                        {isRecording ? "Listening..." : "Hold to speak"}
                    </p>
                </div>
            ) : (
                // Text Mode
                <div className="w-full flex items-center gap-4">
                     <button className="rounded-full bg-gray-200 p-3 text-gray-600 hover:bg-gray-300 transition">
                        <Paperclip size={20} />
                    </button>
                    
                    <div className="flex-1 relative">
                        <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Type a message..."
                        autoFocus
                        className="w-full rounded-full border-gray-300 py-3 pl-6 pr-12 focus:border-indigo-500 focus:ring-indigo-500 shadow-sm"
                        onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                        disabled={isProcessing}
                        />
                        <button 
                            onClick={handleSend}
                            disabled={!input.trim() || isProcessing}
                            className="absolute right-2 top-1.5 rounded-full p-2 text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
                        >
                            <Send size={20} />
                        </button>
                    </div>

                    {/* Toggle to Audio */}
                    <button 
                        onClick={() => setInputType('audio')}
                        className="p-3 rounded-full bg-indigo-100 text-indigo-600 hover:bg-indigo-200 transition"
                        title="Switch to Voice"
                    >
                        <Mic size={20} />
                    </button>
                </div>
            )}
        </div>
      </div>
    </div>
  );
};
