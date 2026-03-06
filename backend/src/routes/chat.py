from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from typing import List, Optional
from concurrent.futures import ThreadPoolExecutor
import shutil
import os
import uuid
import logging

logger = logging.getLogger(__name__)

from .. import models, schemas, auth, database
from ..database import SessionLocal
# Production LangGraph agent (router → web_search/rag_search → synthesize)
from ..graph import run_context_graph, stream_synthesize
from ..stt_handler import transcribe_en, transliterate_hi
from ..tts_handler import speak, generate_audio
import asyncio
import json
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

class AudioGenerateReq(BaseModel):
    request_id: str
    message_id: Optional[int] = None
    
class ReqAudioQuery(BaseModel):
    request_id: str

from collections import OrderedDict

class LRUStateCache:
    def __init__(self, capacity: int = 10):
        self.cache = OrderedDict()
        self.capacity = capacity

    def get(self, key: str):
        if key not in self.cache:
            return None
        self.cache.move_to_end(key)
        return self.cache[key]

    def set(self, key: str, value: dict):
        self.cache[key] = value
        self.cache.move_to_end(key)
        if len(self.cache) > self.capacity:
            self.cache.popitem(last=False)

request_state_manager = LRUStateCache(10)

# Limit background TTS processing to exactly 2 worker threads globally
tts_executor = ThreadPoolExecutor(max_workers=2)

def bg_process_req_audio(req_id: str, audio_path: str):
    try:
        logging.info(f"Background task starting for req audio {req_id}")
        translit_text = transliterate_hi(audio_path)
        state = request_state_manager.get(req_id)
        if state is not None:
            state["translit_text"] = translit_text
        
        if translit_text:
            upload_dir = "uploads"
            os.makedirs(upload_dir, exist_ok=True)
            tts_filename = f"req_{uuid.uuid4()}.mp3"
            tts_path = os.path.join(upload_dir, tts_filename)
            req_audio_url = generate_audio(f"aapne poocha hai ki: {translit_text}. aapka jawab bata rahi hun bas ek minute rukiye", tts_path)
            
            state = request_state_manager.get(req_id)
            if state is not None:
                state["req_audio_url"] = req_audio_url
    except Exception as e:
        logging.error(f"Error in bg_process_req_audio for {req_id}: {e}")

def bg_process_res_audio(req_id: str, text: str):
    try:
        logging.info(f"Background task starting for res audio {req_id}")
        if text:
            upload_dir = "uploads"
            os.makedirs(upload_dir, exist_ok=True)
            tts_filename = f"res_{uuid.uuid4()}.mp3"
            tts_path = os.path.join(upload_dir, tts_filename)
            res_audio_url = generate_audio(text, tts_path)
            
            state = request_state_manager.get(req_id)
            if state is not None:
                state["res_audio_url"] = res_audio_url
                
                # Update DB asynchronously if ai_msg_id is present
                ai_msg_id = state.get("ai_msg_id")
                if ai_msg_id:
                    with SessionLocal() as bg_db:
                        bg_msg = bg_db.query(models.Message).get(ai_msg_id)
                        if bg_msg:
                            bg_msg.audio_url = res_audio_url
                            bg_db.commit()
    except Exception as e:
        logging.error(f"Error in bg_process_res_audio for {req_id}: {e}")

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
    logger.debug(f"DEBUG: transcribe_audio endpoint called with duration: {duration}")
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

        # Transcribe (English)
        logging.info(f"Transcribing file: {file_path}")
        translated_text = transcribe_en(file_path, language_code=language)

        if not translated_text:
            logging.error(f"Transcription failed for file: {file_path}")
            raise HTTPException(status_code=400, detail="Could not transcribe audio")

        logging.info(f"[transcribe] translated='{translated_text[:80]}")

        req_id = str(uuid.uuid4())
        
        # Save isolated transient state matching user workflow sequence
        request_state_manager.set(req_id, {
            "user_audio_url": file_path,   # Baseline actual webm path fallback
        })

        loop = asyncio.get_running_loop()
        loop.run_in_executor(tts_executor, bg_process_req_audio, req_id, file_path)

        return schemas.TranscribeResponse(
            request_id=req_id,
            text=translated_text,
            audio_url=file_path
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"DEBUG: CRITICAL ERROR IN chat_transcribe: {e}")
        logging.exception(f"CRITICAL ERROR IN chat_transcribe: {e}")
        raise HTTPException(status_code=500, detail=str(e))

class TranslitReq(BaseModel):
    request_id: str

@router.post("/chat/transliterate", response_model=schemas.TransliterateResponse)
async def chat_transliterate(
    request: TranslitReq,
    current_user: models.User = Depends(auth.get_current_user)
):
    state = request_state_manager.get(request.request_id)
    if not state:
        raise HTTPException(status_code=404, detail="Request state not found or expired")
        
    for _ in range(150): # Wait up to 15s for the background worker to populate the translt_text
        state = request_state_manager.get(request.request_id)
        if state and "translit_text" in state:
            return schemas.TransliterateResponse(
                request_id=request.request_id,
                translit_text=state["translit_text"]
            )
        await asyncio.sleep(0.1)

    raise HTTPException(status_code=408, detail="Transliteration generation timeout")

@router.post("/chat/res-text")
async def chat_text(
    request: schemas.ChatRequest, 
    db: Session = Depends(database.get_db), 
    current_user: models.User = Depends(auth.get_current_user)
):
    """
    Process a text message and stream the response via Server-Sent Events (SSE).
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

    # Get pipeline state
    state_block = request_state_manager.get(request.request_id)
    if not state_block:
        state_block = {} # Fallback for text-only direct queries without /transcribe wrapper
        
    audio_path = state_block.get('user_audio_url')
    translit_text = state_block.get('translit_text')

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
        audio_url=audio_path
    )
    db.add(user_msg)

    # 4. Create empty assistant stub in DB
    ai_msg = models.Message(
        conversation_id=request.conversation_id, 
        role="assistant", 
        content="",
        audio_url=None
    )
    db.add(ai_msg)
    db.commit()
    db.refresh(ai_msg)
    
    # Store ID in state for res-audio chaining
    if state_block is not None:
        state_block["ai_msg_id"] = ai_msg.id

    # Copy params for the background generator
    user_id = current_user.id
    user_name = current_user.full_name or ""
    user_mobile = current_user.mobile_number or ""
    conv_id = request.conversation_id
    text = request.content
    translit = translit_text
    ai_msg_id = ai_msg.id

    async def event_stream():
        try:
            # 1. Run context graph natively in async context to prevent blocking
            logging.info(f"[chat_text] Gathering context for user={user_id} conv={conv_id}")
            state = await run_context_graph(
                user_id=user_id,
                conversation_id=conv_id,
                user_name=user_name,
                user_mobile=user_mobile,
                user_text=text,
                history=history,
                translit_text=translit,
            )

            # 2. Stream LLM tokens natively to frontend
            full_text = ""
            async for chunk in stream_synthesize(state):
                token = chunk.content
                if token:
                    full_text += token
                    logger.debug(f"[API_YIELD]: {token}")
                    yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"
                    await asyncio.sleep(0)  # Force generic ASGI flush

            # 3. Finalize state in DB with an isolated session
            with SessionLocal() as bg_db:
                bg_msg = bg_db.query(models.Message).get(ai_msg_id)
                if bg_msg:
                    bg_msg.content = full_text
                    bg_db.commit()
            
            # Post completed text to State memory cache
            if state_block is not None:
                state_block["response_text"] = full_text
                # Trigger the background builder for res-audio natively inside the 2-worker executor
                loop = asyncio.get_running_loop()
                loop.run_in_executor(tts_executor, bg_process_res_audio, request.request_id, full_text)

            yield f"data: {json.dumps({'type': 'done', 'message_id': ai_msg_id})}\n\n"

        except Exception as e:
            logging.error(f"[chat_text] Generator Error: {e}")
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"

    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no"
    }

    return StreamingResponse(event_stream(), media_type="text/event-stream", headers=headers)

@router.post("/chat/res-audio")
async def generate_response_audio(
    request: AudioGenerateReq,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    state = request_state_manager.get(request.request_id)
    if not state:
        raise HTTPException(status_code=404, detail="Request state not found or expired")

    for _ in range(300): # Wait up to 30s for the res_audio background builder to finish over the GPU
        state = request_state_manager.get(request.request_id)
        if state and "res_audio_url" in state:
            return {"audio_url": state["res_audio_url"], "request_id": request.request_id}
        await asyncio.sleep(0.1)
        
    raise HTTPException(status_code=408, detail="AI TTS Generation timeout")

@router.post("/chat/req-audio")
async def get_request_audio(
    request: ReqAudioQuery,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    state = request_state_manager.get(request.request_id)
    if not state:
        raise HTTPException(status_code=404, detail="Request state not found or expired")

    for _ in range(150): # Wait up to 15s for the STT-paired translit audio builder
        state = request_state_manager.get(request.request_id)
        if state and "req_audio_url" in state:
            return {"audio_url": state["req_audio_url"], "request_id": request.request_id}
        await asyncio.sleep(0.1)

class BenchmarkQuery(BaseModel):
    text: str
    user_id: str

@router.post("/chat/benchmark")
async def chat_benchmark(request: BenchmarkQuery):
    """
    Lightweight, synchronous text-in/text-out endpoint explicitly for 
    automated benchmarking (DeepEval) without DB history or SSE streams.
    """
    try:
        # Run graph natively
        state = await run_context_graph(
            user_id=request.user_id,
            conversation_id=9999, # Dummy ID for stateless tests
            user_name="Benchmark Tester",
            user_mobile="0000000000",
            user_text=request.text,
            history=[],
            translit_text=""
        )
        
        # Accumulate the streamed response
        full_text = ""
        async for chunk in stream_synthesize(state):
            if chunk.content:
                full_text += chunk.content
                
        return {"response": full_text}
    except Exception as e:
        logger.error(f"[Benchmark] Failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
