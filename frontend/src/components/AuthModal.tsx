import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import client from '../api/client';
import { X, Loader2, Globe } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

declare global {
  interface Window {
    initSendOTP: (config: any) => void;
    sendOtp: (identifier: string, success?: (data: any) => void, failure?: (err: any) => void) => void;
    verifyOtp: (otp: string | number, success?: (data: any) => void, failure?: (err: any) => void) => void;
    retryOtp: (channel: string | null, success?: (data: any) => void, failure?: (err: any) => void, reqId?: string) => void;
    getWidgetData: () => any;
    isCaptchaVerified: () => boolean;
  }
}

type AuthPhase = 'MOBILE' | 'OTP';

const COUNTRY_ISO_MAP: Record<string, string> = {
  '91': 'in',
  '1': 'us',
  '44': 'gb',
  '971': 'ae',
  '61': 'au',
  '1-ca': 'ca',
  '49': 'de',
  '33': 'fr',
  '81': 'jp',
  '65': 'sg',
};

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
  const { user, login } = useAuth();
  const [phase, setPhase] = useState<AuthPhase>('MOBILE');
  const [mobile, setMobile] = useState('');
  const [countryCode, setCountryCode] = useState('91');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isWidgetReady, setIsWidgetReady] = useState(false);
  const [captchaVerified, setCaptchaVerified] = useState(false);
  const isInitialized = useRef(false);

  const isoCode = COUNTRY_ISO_MAP[countryCode] || null;

  // Poll for captcha verification status
  useEffect(() => {
    if (phase !== 'MOBILE' || !isWidgetReady) return;
    
    const interval = setInterval(() => {
      if (window.isCaptchaVerified && window.isCaptchaVerified()) {
        if (!captchaVerified) {
          setCaptchaVerified(true);
        }
      } else {
        if (captchaVerified) {
          setCaptchaVerified(false);
        }
      }
    }, 1000); // 1s is enough and less aggressive
    
    return () => clearInterval(interval);
  }, [phase, isWidgetReady, captchaVerified]);

  const handleSuccess = async (data: any) => {
    const token = typeof data === 'string' ? data : (data.message || data.token);
    if (!token) {
        setError("Token not found in response.");
        return;
    }

    try {
      setLoading(true);
      const res = await client.post('/verify-otp-tok', { token });
      login(res.data.access_token);
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleFailure = (err: any) => {
    setError(typeof err === 'string' ? err : (err.message || 'Operation failed. Please try again.'));
    setLoading(false);
  };

  useEffect(() => {
    if (user) return;

    let initAttempts = 0;
    const maxAttempts = 20;

    const initWidget = (configData: any) => {
      if (!window.initSendOTP) {
        if (initAttempts < maxAttempts) {
          initAttempts++;
          setTimeout(() => initWidget(configData), 500);
        }
        return;
      }

      if (isInitialized.current) {
        setIsWidgetReady(true);
        return;
      }

      window.initSendOTP({
        widgetId: configData.msg91_widget_id,
        tokenAuth: configData.msg91_token_auth,
        exposeMethods: true,
        captchaRenderId: 'msg91-captcha',
        identifier: '',
        success: () => {
          // Success handled via callback
        },
        failure: (err: any) => {
          handleFailure(err);
        },
      });
      isInitialized.current = true;
      setIsWidgetReady(true);
    };

    const loadScriptAndInit = async () => {
      try {
        const configRes = await client.get('/config');
        const configData = configRes.data;

        if (!configData.msg91_widget_id || configData.msg91_widget_id.includes('YOUR_WIDGET_ID')) {
           setError("Waiting for Administrator to configure MSG91 Widget ID.");
           return;
        }

        if (!document.querySelector('script[src*="otp-provider.js"]')) {
          const script = document.createElement('script');
          script.src = 'https://verify.msg91.com/otp-provider.js';
          script.async = true;
          script.onload = () => initWidget(configData);
          document.body.appendChild(script);
        } else {
          initWidget(configData);
        }
      } catch (err) {
        setError("Failed to fetch configuration.");
      }
    };

    loadScriptAndInit();
  }, [user]);

  // Rest of the hooks...

  // Reset phase and errors when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setTimeout(() => {
        setPhase('MOBILE');
        setError('');
        setMobile('');
        setOtp('');
        setCaptchaVerified(false);
      }, 300);
    }
  }, [isOpen]);

  const onSendOtp = () => {
    const isPhoneValid = mobile.length >= 10 && mobile.length <= 11;
    if (!isPhoneValid) {
      setError('Please enter a 10-11 digit mobile number');
      return;
    }

    if (!captchaVerified) {
       setError('Please verify the "Are you human" check');
       return;
    }

    setError('');
    setLoading(true);
    const fullIdentifier = `${countryCode}${mobile}`;
    
    if (window.sendOtp) {
      window.sendOtp(
        fullIdentifier,
        () => {
          setPhase('OTP');
          setLoading(false);
        },
        handleFailure
      );
    } else {
      setError('Widget not ready. Please wait.');
      setLoading(false);
    }
  };

  const onVerifyOtp = () => {
    if (otp.length < 4) {
      setError('Please enter the OTP');
      return;
    }
    setError('');
    setLoading(true);
    if (window.verifyOtp) {
      window.verifyOtp(otp, handleSuccess, handleFailure);
    }
  };

  const onResend = () => {
    setError('');
    if (window.retryOtp) {
      window.retryOtp(null, () => alert('OTP Resent!'), handleFailure);
    }
  };

  const isMobileValid = mobile.length >= 10 && mobile.length <= 11;

  return (
    <div 
      className={`fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md transition-all duration-300 ${
        isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
    >
      <div className={`relative w-full max-w-sm overflow-hidden rounded-3xl bg-zinc-900 border border-white/10 p-8 shadow-2xl transition-transform duration-300 ${
        isOpen ? 'scale-100' : 'scale-95'
      }`}>
        <button onClick={onClose} className="absolute right-6 top-6 text-zinc-500 hover:text-white transition-colors">
          <X size={24} />
        </button>

        <div className="mt-4 text-center">
          <h2 className="text-2xl font-bold text-white mb-2">
            {phase === 'MOBILE' ? 'Welcome to SAI' : 'Verify Identity'}
          </h2>
          <p className="text-zinc-400 text-sm">
            {phase === 'MOBILE' 
              ? 'Login with your mobile number' 
              : `Enter the code sent to +${countryCode}${mobile}`}
          </p>
        </div>

        <div className="mt-12">
          {/* Persistent Captcha Container (outside phase ternary) */}
          <div className={`flex justify-center mb-10 transition-all duration-300 ${phase === 'MOBILE' ? 'opacity-100 h-auto' : 'opacity-0 h-0 overflow-hidden'}`}>
            <div id="msg91-captcha" className="w-[302px] min-h-[78px] flex justify-center items-center" />
          </div>

          <div className="space-y-10">
            {phase === 'MOBILE' ? (
              <div className="space-y-10">
                <div className="flex gap-2">
                  <div className="w-28 relative">
                     <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none">
                        {isoCode ? (
                          <img 
                            src={`https://flagcdn.com/w20/${isoCode}.png`} 
                            alt={isoCode} 
                            className="w-4 h-3 object-cover rounded-sm shadow-sm"
                          />
                        ) : (
                          <Globe size={14} className="text-zinc-500" />
                        )}
                        <span className="text-zinc-500 text-xs">+</span>
                     </div>
                    <input 
                      type="number"
                      value={countryCode}
                      onChange={(e) => setCountryCode(e.target.value)}
                      className="w-full h-12 bg-white/5 border border-white/10 rounded-xl pl-11 pr-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-medium"
                      placeholder="91"
                    />
                  </div>
                  <input 
                    type="number"
                    value={mobile}
                    onChange={(e) => {
                      const val = e.target.value.slice(0, 11);
                      if (val !== mobile) {
                        setMobile(val);
                        setCaptchaVerified(false);
                      }
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && isMobileValid && captchaVerified && onSendOtp()}
                    className="flex-1 h-12 bg-white/5 border border-white/10 rounded-xl px-4 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-medium tracking-widest"
                    placeholder="Mobile Number"
                    autoFocus={isOpen && phase === 'MOBILE'}
                  />
                </div>

                <button 
                  onClick={onSendOtp}
                  disabled={loading || !isWidgetReady || !isMobileValid || !captchaVerified}
                  className="w-full h-12 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-20 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2"
                >
                  {loading ? <Loader2 className="animate-spin" size={20} /> : 'Send OTP'}
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                <input 
                  type="number"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && onVerifyOtp()}
                  className="w-full h-14 bg-white/5 border border-white/10 rounded-xl px-4 text-white text-center text-3xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-bold tracking-[0.5em]"
                  placeholder="••••••"
                  autoFocus={isOpen && phase === 'OTP'}
                />
                <button 
                  onClick={onVerifyOtp}
                  disabled={loading}
                  className="w-full h-12 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold rounded-xl transition-all shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2"
                >
                  {loading ? <Loader2 className="animate-spin" size={20} /> : 'Verify & Enter'}
                </button>
                <div className="flex justify-between items-center px-1">
                  <button 
                    onClick={() => setPhase('MOBILE')}
                    className="text-xs text-zinc-500 hover:text-white transition-colors"
                  >
                    Change number
                  </button>
                  <button 
                    onClick={onResend}
                    className="text-xs text-indigo-400 hover:text-indigo-300 font-medium"
                  >
                    Resend OTP
                  </button>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-center">
              <p className="text-red-400 text-xs font-medium">{error}</p>
            </div>
          )}
        </div>

        <div className="mt-12 text-center border-t border-white/5 pt-6">
          <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-bold">
            Powered by Secure Auth
          </p>
        </div>
      </div>
    </div>
  );
};

