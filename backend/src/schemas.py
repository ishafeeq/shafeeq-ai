from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class UserBase(BaseModel):
    mobile_number: str
    email: Optional[str] = None

class UserUpdate(BaseModel):
    full_name: str

class MobileLogin(BaseModel):
    mobile_number: str

class Msg91Token(BaseModel):
    token: str

class OTPVerify(BaseModel):
    mobile_number: str
    otp: str
    full_name: Optional[str] = None # For signup

class User(UserBase):
    id: int
    full_name: Optional[str] = None
    credits_balance: float
    plan_type: str
    
    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    email: Optional[str] = None

class ChatRequest(BaseModel):
    conversation_id: int
    content: str           # English translated text (from Sarvam STT translate mode)
    translit_text: Optional[str] = None  # Hinglish transliteration (for UI, passed to graph)
    audio_url: Optional[str] = None
    generate_audio: bool = False

class TranscribeResponse(BaseModel):
    text: str              # English translated text (for LangGraph)
    translit_text: str     # Hinglish/Devanagari (for UI display)
    audio_url: str
    intermediate_audio_url: Optional[str] = None

class MessageBase(BaseModel):
    role: str
    content: str
    audio_url: Optional[str] = None

class MessageCreate(MessageBase):
    pass

class Message(MessageBase):
    id: int
    conversation_id: int
    created_at: datetime
    
    class Config:
        from_attributes = True

class ConversationBase(BaseModel):
    title: str

class ConversationCreate(ConversationBase):
    pass

class Conversation(ConversationBase):
    id: int
    created_at: datetime
    user_id: int
    messages: list[Message] = []
    
    class Config:
        from_attributes = True

class AudioResponse(BaseModel):
    user_message: Message
    ai_message: Message
