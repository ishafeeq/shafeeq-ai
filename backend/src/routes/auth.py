from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from datetime import datetime, timedelta

from .. import models, schemas, auth, database

router = APIRouter(tags=["Authentication"])

@router.post("/send-otp")
def send_otp(request: schemas.MobileLogin, db: Session = Depends(database.get_db)):
    user = db.query(models.User).filter(models.User.mobile_number == request.mobile_number).first()
    
    otp = auth.generate_otp()
    otp_expiry = datetime.utcnow() + timedelta(minutes=5)
    
    if not user:
        # Create a temporary user record or just handle transiently. 
        # Ideally, we create user on verification.
        # For simplicity, we can pass OTP back or store in a separate OTP table.
        # But commonly we upsert user with null details or use a temporary store.
        # Let's create/update the user record with the OTP.
        user = models.User(mobile_number=request.mobile_number)
        db.add(user)
    
    user.otp = otp
    user.otp_expiry = otp_expiry
    db.commit()
    
    # In production, send SMS here.
    print(f"OTP for {request.mobile_number}: {otp}")
    
    return {"message": "OTP sent successfully", "dev_otp": otp}

@router.post("/verify-otp", response_model=schemas.Token)
def verify_otp(request: schemas.OTPVerify, db: Session = Depends(database.get_db)):
    user = db.query(models.User).filter(models.User.mobile_number == request.mobile_number).first()
    
    if not user or not user.otp:
        raise HTTPException(status_code=400, detail="Invalid request")
    
    if user.otp_expiry < datetime.utcnow():
        raise HTTPException(status_code=400, detail="OTP expired")
        
    if not auth.verify_otp(request.otp, user.otp):
        raise HTTPException(status_code=400, detail="Invalid OTP")
    
    # Clear OTP
    user.otp = None
    user.otp_expiry = None
    
    # Update full name if provided (Registration flow)
    if request.full_name:
        user.full_name = request.full_name
        
    db.commit()
    db.refresh(user)
    
    access_token = auth.create_access_token(
        data={"sub": user.mobile_number}
    )
    return {"access_token": access_token, "token_type": "bearer"}

@router.get("/users/me", response_model=schemas.User)
async def read_users_me(current_user: schemas.User = Depends(auth.get_current_user)):
    return current_user
