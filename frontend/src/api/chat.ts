import client from './client';

export interface Message {
    id: number;
    role: 'user' | 'assistant';
    content: string;          // English translated text (stored in DB)
    translit_text?: string;   // Hinglish — shown as main text in UI (voice messages only)
    is_voice?: boolean;       // Indicates if the message originated from voice input
    audio_url?: string;
    intermediate_audio_url?: string;
    created_at: string;
}

export interface Conversation {
    id: number;
    title: string;
    messages: Message[];
    created_at: string;
}

export interface AudioResponse {
    user_message: Message;
    ai_message: Message;
}

export const chatApi = {
    createConversation: async (title: string = "New Chat") => {
        const response = await client.post<Conversation>('/conversations', { title });
        return response.data;
    },

    getConversations: async (skip: number = 0, limit: number = 100) => {
        const response = await client.get<Conversation[]>(`/conversations?skip=${skip}&limit=${limit}`);
        return response.data;
    },

    getConversation: async (id: number) => {
        const response = await client.get<Conversation>(`/conversations/${id}`);
        return response.data;
    },

    sendText: async (conversationId: number, content: string, translitText?: string, audioUrl?: string, generateAudio: boolean = false) => {
        const response = await client.post<Message>('/chat/text', {
            conversation_id: conversationId,
            content,
            translit_text: translitText || null,
            audio_url: audioUrl,
            generate_audio: generateAudio
        });
        return response.data;
    },

    getTransliteration: async (requestId: string) => {
        const response = await client.post<{ translit_text: string, request_id: string }>('/chat/transliterate', { request_id: requestId });
        return response.data;
    },

    generateResponseAudio: async (requestId: string) => {
        const response = await client.post<{ audio_url: string, request_id: string }>('/chat/res-audio', { request_id: requestId });
        return response.data;
    },

    requestAudio: async (requestId: string) => {
        const response = await client.post<{ audio_url: string, request_id: string }>('/chat/req-audio', { request_id: requestId });
        return response.data;
    },

    streamResponseText: async (
        requestId: string,
        conversationId: number,
        content: string,
        onEvent: (event: { type: string, content?: string, url?: string, message_id?: number }) => void
    ) => {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/chat/res-text', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            },
            body: JSON.stringify({
                request_id: requestId,
                conversation_id: conversationId,
                content
            })
        });

        if (!response.ok) throw new Error("Stream request failed");
        if (!response.body) throw new Error("No readable stream");

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n\n');
            buffer = lines.pop() || "";

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const dataStr = line.substring(6);
                    if (dataStr.trim() === '[DONE]') continue;
                    try {
                        const parsed = JSON.parse(dataStr);
                        onEvent(parsed);
                    } catch (e) {
                        console.error("Failed to parse SSE line", line);
                    }
                }
            }
        }
    },

    transcribeAudio: async (audioBlob: Blob, duration: number, language: string = 'hi-IN') => {
        const formData = new FormData();
        formData.append('file', audioBlob, 'recording.webm');
        formData.append('language', language);
        formData.append('duration', duration.toString());
        const response = await client.post<{ text: string, request_id: string, audio_url: string }>('/chat/transcribe', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
        return response.data;
    },
};
