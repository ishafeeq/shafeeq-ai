from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
import requests
import os

from .. import models, schemas, auth, database

router = APIRouter(tags=["Authentication"])
OTP_AUTH_KEY = os.environ["OTP_AUTH_KEY"]

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

@router.put("/users/me", response_model=schemas.User)
def update_user_me(
    update_data: schemas.UserUpdate,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    # Re-fetch from DB to ensure it's attached and up-to-date
    user = db.query(models.User).filter(models.User.id == current_user.id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    user.full_name = update_data.full_name
    db.commit()
    db.refresh(user)
    return user

@router.post("/verify-otp-tok", response_model=schemas.Token)
def verify_otp_tok(request: schemas.Msg91Token, db: Session = Depends(database.get_db)):
    authkey = OTP_AUTH_KEY
    url = "https://control.msg91.com/api/v5/widget/verifyAccessToken"
    
    headers = {"Content-Type": "application/json"}
    payload = {
        "authkey": authkey,
        "access-token": request.token
    }
    
    response = requests.post(url, json=payload, headers=headers)
    if response.status_code != 200:
        raise HTTPException(status_code=400, detail="Invalid auth provider token")
        
    data = response.json()
    if data.get("type") != "success":
        raise HTTPException(status_code=400, detail="Verification failed")
        
    mobile_number = data.get("message")
    if not mobile_number:
        raise HTTPException(status_code=400, detail="Mobile number not received")
    
    if not str(mobile_number).startswith('+'):
        mobile_number = '+' + str(mobile_number)

    user = db.query(models.User).filter(models.User.mobile_number == mobile_number).first()
    
    if not user:
        user = models.User(mobile_number=mobile_number)
        db.add(user)
        db.commit()
        db.refresh(user)
        
    access_token = auth.create_access_token(
        data={"sub": user.mobile_number}
    )
    return {"access_token": access_token, "token_type": "bearer"}
