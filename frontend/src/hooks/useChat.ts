import { useState, useEffect, useRef, useCallback } from 'react';
import { chatApi, type Message, type Conversation } from '../api/chat';
import { useAuth } from '../context/AuthContext';

export const useChat = () => {
    const { user } = useAuth();
    const [messages, setMessages] = useState<Message[]>([]);
    const [conversationId, setConversationId] = useState<number | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [processingStep, setProcessingStep] = useState<string>(''); // 'Transcribing', 'Thinking', etc.
    const [conversations, setConversations] = useState<Conversation[]>([]);

    const streamQueueRef = useRef<{ id: number, text: string }[]>([]);
    const isTypingRef = useRef(false);
    const idMapRef = useRef<Record<number, number>>({});
    const lastProcessTimeRef = useRef<number>(0);

    const processQueue = useCallback(() => {
        if (streamQueueRef.current.length === 0) {
            isTypingRef.current = false;
            return;
        }

        const now = Date.now();
        if (now - lastProcessTimeRef.current < 40) {
            requestAnimationFrame(processQueue);
            return;
        }
        lastProcessTimeRef.current = now;

        isTypingRef.current = true;

        // Process max 2 tokens per 40ms for a slower, human-like typing effect
        const itemsToProcess = Math.min(2, Math.max(1, Math.ceil(streamQueueRef.current.length / 50)));
        const items = streamQueueRef.current.splice(0, itemsToProcess);

        if (items.length > 0) {
            setMessages((prev: Message[]) => prev.map((msg: Message) => {
                let appended = "";
                for (const item of items) {
                    const mappedId = idMapRef.current[item.id];
                    if (item.id === msg.id || (mappedId && msg.id === mappedId)) {
                        appended += item.text;
                    }
                }
                if (appended) {
                    return { ...msg, content: msg.content + appended };
                }
                return msg;
            }));
        }

        requestAnimationFrame(processQueue);
    }, []);

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

        try {
            const id = await initializeChat();
            const reqId = "text-" + Date.now().toString() + "-" + Math.floor(Math.random() * 100000);

            const tempUserMsgId = Date.now();
            const userMsg: Message = {
                id: tempUserMsgId,
                role: 'user',
                content,
                created_at: new Date().toISOString()
            };
            setMessages(prev => [...prev, userMsg]);

            const tempAiMsgId = Date.now() + 1;
            const aiMsg: Message = {
                id: tempAiMsgId,
                role: 'assistant',
                content: '',
                created_at: new Date().toISOString()
            };
            setMessages(prev => [...prev, aiMsg]);

            await chatApi.streamResponseText(
                reqId,
                id,
                content,
                (event) => {
                    console.log("[UI_RECEIVED_EVENT]:", event);
                    if (event.type === 'token') {
                        streamQueueRef.current.push({ id: tempAiMsgId, text: event.content || "" });
                        setProcessingStep('Typing...');
                        if (!isTypingRef.current) {
                            requestAnimationFrame(processQueue);
                        }
                    } else if (event.type === 'audio') {
                        setMessages((prev: Message[]) => prev.map((msg: Message) =>
                            msg.id === tempAiMsgId
                                ? { ...msg, audio_url: event.url }
                                : msg
                        ));
                    } else if (event.type === 'done') {
                        const finalId = event.message_id || tempAiMsgId;
                        idMapRef.current[tempAiMsgId] = finalId;
                        setMessages((prev: Message[]) => prev.map((msg: Message) =>
                            msg.id === tempAiMsgId
                                ? { ...msg, id: finalId }
                                : msg
                        ));

                        // 5. Generate Response Audio
                        setProcessingStep('Generating AI Audio...');
                        chatApi.generateResponseAudio(reqId).then(res => {
                            setMessages((prev: Message[]) => prev.map((msg: Message) =>
                                msg.id === finalId ? { ...msg, audio_url: res.audio_url } : msg
                            ));
                            window.dispatchEvent(new CustomEvent('playAiAudio', { detail: { msgId: finalId, url: res.audio_url } }));
                        }).catch(e => {
                            console.error("Audio Generation Failed", e);
                        }).finally(() => {
                            setProcessingStep('');
                        });
                    }
                }
            );
        } catch (error: any) {
            console.error("Failed to send message", error);
            const errorDetail = error.response?.data?.detail || error.message || 'Unknown server error';
            const errMsg: Message = {
                id: Date.now(),
                role: 'assistant',
                content: `Error: ${errorDetail}`,
                created_at: new Date().toISOString()
            };
            setMessages(prev => [...prev, errMsg]);
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

            // Step 1: Transcribe (English)
            const transcription = await chatApi.transcribeAudio(audioBlob, duration, language);
            const reqId = transcription.request_id;

            const userMsgId = Date.now();
            const userMsg: Message = {
                id: userMsgId,
                role: 'user',
                is_voice: true,
                content: transcription.text,
                created_at: new Date().toISOString()
            };
            setMessages(prev => [...prev, userMsg]);

            // Step 2: Transliterate (Hinglish)
            setProcessingStep('Transliterating...');
            const translitRes = await chatApi.getTransliteration(reqId);
            setMessages(p => p.map(m => m.id === userMsgId ? { ...m, translit_text: translitRes.translit_text } : m));

            // Step 3: Request Audio
            setProcessingStep('Generating User Audio...');
            chatApi.requestAudio(reqId).then((res: { audio_url: string }) => {
                setMessages(p => p.map(m => m.id === userMsgId ? { ...m, audio_url: res.audio_url } : m));
            }).catch((e: any) => console.error("Failed User req-audio", e));

            setProcessingStep('Thinking...');

            const tempAiMsgId = Date.now() + 1;
            const aiMsg: Message = {
                id: tempAiMsgId,
                role: 'assistant',
                content: '',
                created_at: new Date().toISOString()
            };
            setMessages(prev => [...prev, aiMsg]);

            // Step 4: Stream response text
            await chatApi.streamResponseText(
                reqId,
                id,
                transcription.text,
                (event) => {
                    console.log("[UI_RECEIVED_EVENT]:", event);
                    if (event.type === 'token') {
                        streamQueueRef.current.push({ id: tempAiMsgId, text: event.content || "" });
                        setProcessingStep('Typing...');
                        if (!isTypingRef.current) {
                            requestAnimationFrame(processQueue);
                        }
                    } else if (event.type === 'audio') {
                        setMessages((prev: Message[]) => prev.map((msg: Message) =>
                            msg.id === tempAiMsgId
                                ? { ...msg, audio_url: event.url }
                                : msg
                        ));
                    } else if (event.type === 'done') {
                        const finalId = event.message_id || tempAiMsgId;
                        idMapRef.current[tempAiMsgId] = finalId;
                        setMessages((prev: Message[]) => prev.map((msg: Message) =>
                            msg.id === tempAiMsgId
                                ? { ...msg, id: finalId }
                                : msg
                        ));

                        // Step 5: Fetch Response Audio after stream completes
                        setProcessingStep('Generating AI Audio...');
                        chatApi.generateResponseAudio(reqId).then(res => {
                            setMessages((prev: Message[]) => prev.map((msg: Message) =>
                                msg.id === finalId ? { ...msg, audio_url: res.audio_url } : msg
                            ));
                            window.dispatchEvent(new CustomEvent('playAiAudio', { detail: { msgId: finalId, url: res.audio_url } }));
                        }).catch(e => {
                            console.error("Audio Generation Failed", e);
                        }).finally(() => {
                            setProcessingStep('');
                        });
                    }
                }
            );

        } catch (error: any) {
            console.error("Failed to send audio", error);
            const errorDetail = error.response?.data?.detail || error.message || 'Unknown server error';
            const errMsg: Message = {
                id: Date.now(),
                role: 'assistant',
                content: `Error transcribing audio: ${errorDetail}`,
                created_at: new Date().toISOString()
            };
            setMessages(prev => [...prev, errMsg]);
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
