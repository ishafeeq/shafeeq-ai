import { useState } from 'react';
import { chatApi, type Message } from '../api/chat';

export const useChat = () => {
    const [messages, setMessages] = useState<Message[]>([]);
    const [conversationId, setConversationId] = useState<number | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [processingStep, setProcessingStep] = useState<string>(''); // 'Transcribing', 'Thinking', etc.

    const initializeChat = async () => {
        if (!conversationId) {
            const conv = await chatApi.createConversation();
            setConversationId(conv.id);
            return conv.id;
        }
        return conversationId;
    };

    const sendMessage = async (content: string) => {
        setIsProcessing(true);
        setProcessingStep('Thinking...');

        // Optimistic UI update? Or wait for response? 
        // Let's wait for response for now to ensure consistency, but usually we show user msg immediately.
        // We'll let the component handle the immediate user msg display if needed, 
        // but here we deal with the API result.

        try {
            const id = await initializeChat();
            const response = await chatApi.sendText(id, content);
            setMessages(prev => [...prev, response]);
            return response;
        } catch (error) {
            console.error("Failed to send message", error);
        } finally {
            setIsProcessing(false);
            setProcessingStep('');
        }
    };

    const sendAudio = async (audioBlob: Blob, language: string = 'hi-IN') => {
        setIsProcessing(true);
        setProcessingStep('Transcribing...');

        try {
            const id = await initializeChat();

            // Step 1: Transcribe — returns { text (English), translit_text (Hinglish), audio_url }
            const transcription = await chatApi.transcribeAudio(audioBlob, language);

            // Optimistic Update: Show user message with Hinglish text as main
            const userMsg: Message = {
                id: Date.now(),
                role: 'user',
                content: transcription.text,                    // English (for DB/graph)
                translit_text: transcription.translit_text,    // Hinglish (shown in UI)
                audio_url: transcription.audio_url,
                created_at: new Date().toISOString()
            };
            setMessages(prev => [...prev, userMsg]);

            setProcessingStep('Thinking...');

            // Step 2: Send to LangGraph with translit context and request TTS
            const aiResponse = await chatApi.sendText(
                id,
                transcription.text,          // English → graph reasoning
                transcription.translit_text, // Hinglish → query_refiner context
                transcription.audio_url,
                true
            );

            // Update messages with AI response
            setMessages(prev => [...prev, aiResponse]);

        } catch (error) {
            console.error("Failed to send audio", error);
        } finally {
            setIsProcessing(false);
            setProcessingStep('');
        }
    };

    return {
        messages,
        setMessages,
        sendMessage,
        sendAudio,
        isProcessing,
        processingStep
    };
};
