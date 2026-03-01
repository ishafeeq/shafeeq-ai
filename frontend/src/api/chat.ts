import client from './client';

export interface Message {
    id: number;
    role: 'user' | 'assistant';
    content: string;          // English translated text (stored in DB)
    translit_text?: string;   // Hinglish — shown as main text in UI (voice messages only)
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

    transcribeAudio: async (audioBlob: Blob, duration: number, language: string = 'hi-IN') => {
        const formData = new FormData();
        formData.append('file', audioBlob, 'recording.webm');
        formData.append('language', language);
        formData.append('duration', duration.toString());
        const response = await client.post<{ text: string, translit_text: string, audio_url: string, intermediate_audio_url?: string }>('/chat/transcribe', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
        return response.data;
    },
};
