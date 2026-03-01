import { useState, useEffect } from 'react';
import { chatApi, type Message, type Conversation } from '../api/chat';
import { useAuth } from '../context/AuthContext';

export const useChat = () => {
    const { user } = useAuth();
    const [messages, setMessages] = useState<Message[]>([]);
    const [conversationId, setConversationId] = useState<number | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [processingStep, setProcessingStep] = useState<string>(''); // 'Transcribing', 'Thinking', etc.
    const [conversations, setConversations] = useState<Conversation[]>([]);

    const fetchConversations = async () => {
        try {
            const data = await chatApi.getConversations();
            setConversations(data);
        } catch (error) {
            console.error("Failed to fetch conversations", error);
        }
    };

    const loadConversation = async (id: number) => {
        try {
            const data = await chatApi.getConversation(id);
            setConversationId(data.id);
            setMessages(data.messages || []);
        } catch (error) {
            console.error("Failed to load conversation", error);
        }
    };

    useEffect(() => {
        if (user) {
            fetchConversations();
        } else {
            setConversations([]);
            setConversationId(null);
            setMessages([]);
        }
    }, [user]);

    const initializeChat = async () => {
        if (!conversationId) {
            const conv = await chatApi.createConversation();
            setConversationId(conv.id);
            await fetchConversations();
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

    const sendAudio = async (audioBlob: Blob, duration: number, language: string = 'hi-IN') => {
        setIsProcessing(true);
        setProcessingStep('Transcribing...');

        try {
            const id = await initializeChat();

            // Step 1: Transcribe — returns { text, translit_text, audio_url }
            const transcription = await chatApi.transcribeAudio(audioBlob, duration, language);

            // Optimistic Update: Show user message with Hinglish text as main
            const userMsg: Message = {
                id: Date.now(),
                role: 'user',
                content: transcription.text,                    // English (for DB/graph)
                translit_text: transcription.translit_text,    // Hinglish (shown in UI)
                audio_url: transcription.audio_url,
                intermediate_audio_url: transcription.intermediate_audio_url,
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
        processingStep,
        conversations,
        fetchConversations,
        loadConversation,
        conversationId,
        setConversationId
    };
};
