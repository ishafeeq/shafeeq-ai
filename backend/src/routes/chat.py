from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from typing import List, Optional
import shutil
import os
import uuid
import logging

from .. import models, schemas, auth, database
# Production LangGraph agent (router → web_search/rag_search → synthesize)
from ..graph import run_graph
from ..stt_handler import transcribe
from ..tts_handler import speak, generate_audio

router = APIRouter(tags=["Chat & History"])

# --- History Endpoints ---

@router.get("/conversations", response_model=List[schemas.Conversation])
def get_conversations(skip: int = 0, limit: int = 100, db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.get_current_user)):
    conversations = db.query(models.Conversation).filter(models.Conversation.user_id == current_user.id).offset(skip).limit(limit).all()
    return conversations

@router.post("/conversations", response_model=schemas.Conversation)
def create_conversation(conversation: schemas.ConversationCreate, db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.get_current_user)):
    db_conversation = models.Conversation(**conversation.dict(), user_id=current_user.id)
    db.add(db_conversation)
    db.commit()
    db.refresh(db_conversation)
    return db_conversation

@router.get("/conversations/{conversation_id}", response_model=schemas.Conversation)
def get_conversation(conversation_id: int, db: Session = Depends(database.get_db), current_user: models.User = Depends(auth.get_current_user)):
    conversation = db.query(models.Conversation).filter(models.Conversation.id == conversation_id, models.Conversation.user_id == current_user.id).first()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation

# --- Chat / Audio Endpoints ---

@router.post("/chat/transcribe", response_model=schemas.TranscribeResponse)
async def transcribe_audio(
    file: UploadFile = File(...),
    duration: float = Form(0.0),
    language: str = Form("hi-IN"),
    current_user: models.User = Depends(auth.get_current_user)
):
    print(f"DEBUG: transcribe_audio endpoint called with duration: {duration}")
    try:
        if duration > 30.0:
            raise HTTPException(status_code=400, detail="Audio file too long. Maximum 30 seconds allowed.")

        if current_user.credits_balance <= 0:
            raise HTTPException(status_code=400, detail="Insufficient credits. Please upgrade your plan.")

        # Save Uploaded Audio
        upload_dir = "uploads"
        os.makedirs(upload_dir, exist_ok=True)
        file_ext = file.filename.split(".")[-1]
        filename = f"{uuid.uuid4()}.{file_ext}"
        file_path = os.path.join(upload_dir, filename)
        
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        # Validate file size (heuristics for 30s of WebM/Wav usually < 5MB)
        # We will restrict to 5MB to be safe, as Sarvam only supports 30s.
        file_size_mb = os.path.getsize(file_path) / (1024 * 1024)
        if file_size_mb > 5.0:
            os.remove(file_path) # Clean up
            raise HTTPException(status_code=400, detail="Audio file too large. Maximum 30 seconds allowed.")

        # Transcribe: returns {"translated_text": str, "translit_text": str}
        logging.info(f"Transcribing file: {file_path}")
        stt_result = transcribe(file_path, language_code=language)
        translated_text = stt_result.get("translated_text", "")
        translit_text   = stt_result.get("translit_text", "")

        if not translated_text:
            logging.error(f"Transcription failed for file: {file_path}")
            raise HTTPException(status_code=400, detail="Could not transcribe audio")

        logging.info(f"[transcribe] translated='{translated_text[:80]}' translit='{translit_text[:80]}'")

        # Generate intermediate audio
        intermediate_audio_url = None
        if translit_text:
            try:
                # Custom acknowledgement text replacing {user's_query}
                ack_text = f"aapka sawal hai: '{translit_text}'. Main is bare mein soch samajh kar answer deti hun, thoda sa time den mjhe bas."
                
                tts_filename = f"intermediate_{uuid.uuid4()}.mp3"
                tts_path = os.path.join(upload_dir, tts_filename)
                logging.info(f"[transcribe] Generating intermediate TTS audio → {tts_path}")
                intermediate_audio_url = generate_audio(ack_text, tts_path)
            except Exception as e:
                logging.error(f"[transcribe] Intermediate TTS failed: {e}")

        return schemas.TranscribeResponse(
            text=translated_text,
            translit_text=translit_text,
            audio_url=intermediate_audio_url if intermediate_audio_url else file_path,
            intermediate_audio_url=intermediate_audio_url,
        )

    except HTTPException:
        raise
    except Exception as e:
        print(f"DEBUG: CRITICAL ERROR IN chat_transcribe: {e}")
        logging.exception(f"CRITICAL ERROR IN chat_transcribe: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/chat/text", response_model=schemas.Message)
def chat_text(
    request: schemas.ChatRequest, 
    db: Session = Depends(database.get_db), 
    current_user: models.User = Depends(auth.get_current_user)
):
    """
    Process a text message through the production LangGraph agent.

    IMPORTANT: request.content MUST be the English-translated output from
    Sarvam Saaras-v3 STT (translate mode). The frontend sends this after
    calling /chat/transcribe, which returns the English text.
    The graph router, web search, RAG, and synthesizer all operate on English.
    """
    # 1. Verify conversation ownership
    conversation = db.query(models.Conversation).filter(
        models.Conversation.id == request.conversation_id,
        models.Conversation.user_id == current_user.id
    ).first()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # 1.5 Verify user has enough credits
    if current_user.credits_balance <= 0:
        raise HTTPException(status_code=400, detail="Insufficient credits. Please upgrade your plan.")

    # 1.6 Deduct credit
    current_user.credits_balance -= 1
    db.commit()

    # 2. Load conversation history (last 20 messages) for LangGraph context
    prior_messages = (
        db.query(models.Message)
        .filter(models.Message.conversation_id == request.conversation_id)
        .order_by(models.Message.created_at.asc())
        .limit(20)
        .all()
    )
    history = [{"role": m.role, "content": m.content} for m in prior_messages]

    # 3. Save user message to DB
    user_msg = models.Message(
        conversation_id=request.conversation_id, 
        role="user", 
        content=request.content,   # English text from Sarvam STT
        audio_url=request.audio_url
    )
    db.add(user_msg)
    db.commit()

    # 4. Run production LangGraph agent
    #    - request.content = English text from Sarvam Saaras-v3 (translate mode)
    #    - thread_id = f"user_{user_id}_conv_{conversation_id}" (JWT session → LangGraph checkpoint)
    logging.info(f"[chat_text] Invoking graph for user={current_user.id} conv={request.conversation_id}")
    ai_response_text = run_graph(
        user_id=current_user.id,
        conversation_id=request.conversation_id,
        user_name=current_user.full_name or "",
        user_mobile=current_user.mobile_number or "",
        user_text=request.content,          # ← English from Sarvam STT translate mode
        history=history,
        translit_text=request.translit_text or None,  # ← Hinglish from STT translit mode
    )

    # 5. Generate Audio Response via Sarvam Bulbul-v3 TTS (Optional)
    ai_audio_url = None
    if request.generate_audio:
        try:
            from ..tts_handler import generate_audio
            upload_dir = "uploads"
            os.makedirs(upload_dir, exist_ok=True)
            tts_filename = f"response_{uuid.uuid4()}.mp3"
            tts_path = os.path.join(upload_dir, tts_filename)
            logging.info(f"[chat_text] Generating TTS audio → {tts_path}")
            ai_audio_url = generate_audio(ai_response_text, tts_path)
        except Exception as e:
            logging.error(f"[chat_text] TTS failed: {e}")

    # 6. Save assistant message to DB
    ai_msg = models.Message(
        conversation_id=request.conversation_id, 
        role="assistant", 
        content=ai_response_text,
        audio_url=ai_audio_url
    )
    db.add(ai_msg)
    db.commit()
    db.refresh(ai_msg)
    
    return ai_msg


