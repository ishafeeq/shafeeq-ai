import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import client from '../api/client';
import { X, User, Mail, Loader2, ArrowRight } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Step = 'MOBILE' | 'OTP' | 'PROFILE';

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
  const [step, setStep] = useState<Step>('MOBILE');
  const [mobileNumber, setMobileNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const { login } = useAuth();

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      if (step === 'MOBILE') {
        if (mobileNumber.length !== 10) {
          setError('Please enter a 10-digit mobile number.');
          setIsLoading(false);
          return;
        }
        await client.post('/send-otp', { mobile_number: `+91${mobileNumber}` });
        setStep('OTP');
      } else if (step === 'OTP') {
        if (otp.length !== 6) {
          setError('Please enter a 6-digit OTP.');
          setIsLoading(false);
          return;
        }
        const response = await client.post('/verify-otp', {
          mobile_number: `+91${mobileNumber}`,
          otp,
        });
        if (response.data.is_new_user) {
          setStep('PROFILE');
        } else {
          login(response.data.access_token);
          onClose();
        }
      } else if (step === 'PROFILE') {
        if (!fullName.trim()) {
          setError('Full Name is required.');
          setIsLoading(false);
          return;
        }
        const response = await client.post('/complete-profile', {
          mobile_number: `+91${mobileNumber}`,
          full_name: fullName,
          email: email || undefined,
        });
        login(response.data.access_token);
        onClose();
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || 'An unexpected error occurred.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative w-full max-w-md overflow-hidden rounded-3xl bg-[#09090b] border border-zinc-800 shadow-2xl p-8">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-zinc-500 hover:text-white transition-colors"
        >
          <X size={24} />
        </button>

        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/20">
            <span className="text-2xl font-bold">B</span>
          </div>
          <h2 className="text-2xl font-bold text-white">
            {step === 'MOBILE'
              ? 'Welcome to Bol AI'
              : step === 'OTP'
              ? 'Verify OTP'
              : 'Complete Profile'}
          </h2>
          <p className="mt-2 text-sm text-zinc-400">
            {step === 'MOBILE'
              ? 'Enter your mobile number to continue'
              : step === 'OTP'
              ? `Enter the code sent to +91 ${mobileNumber}`
              : 'Tell us a bit about yourself'}
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded-xl bg-red-500/10 p-3 text-sm text-red-400 border border-red-500/20">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {step === 'MOBILE' && (
            <div>
              <label className="mb-2 block text-sm font-medium text-zinc-400">
                Mobile Number
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">+91</span>
                <input
                  type="tel"
                  maxLength={10}
                  value={mobileNumber}
                  onChange={(e) => setMobileNumber(e.target.value.replace(/\D/g, ''))}
                  className="w-full rounded-2xl border border-zinc-800 bg-zinc-900 py-3.5 pl-12 pr-4 text-white placeholder-zinc-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                  placeholder="9876543210"
                  autoFocus
                />
              </div>
            </div>
          )}

          {step === 'OTP' && (
            <div>
              <label className="mb-2 block text-sm font-medium text-zinc-400">
                OTP Code
              </label>
              <input
                type="text"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                className="w-full rounded-2xl border border-zinc-800 bg-zinc-900 py-3.5 px-4 text-center text-2xl tracking-[0.5em] text-white placeholder-zinc-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                placeholder="••••••"
                autoFocus
              />
            </div>
          )}

          {step === 'PROFILE' && (
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-400">
                  Full Name
                </label>
                <div className="relative">
                  <User size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full rounded-2xl border border-zinc-800 bg-zinc-900 py-3.5 pl-12 pr-4 text-white placeholder-zinc-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                    placeholder="John Doe"
                    autoFocus
                  />
                </div>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-400">
                  Email <span className="text-zinc-600">(Optional)</span>
                </label>
                <div className="relative">
                  <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-2xl border border-zinc-800 bg-zinc-900 py-3.5 pl-12 pr-4 text-white placeholder-zinc-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                    placeholder="john@example.com"
                  />
                </div>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="group flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 py-3.5 font-medium text-white transition-all hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed mt-6"
            style={{ boxShadow: '0 0 20px rgba(59, 130, 246, 0.3)' }}
          >
            {isLoading ? (
              <Loader2 className="animate-spin" size={20} />
            ) : (
              <>
                {step === 'MOBILE' ? 'Send OTP' : step === 'OTP' ? 'Verify' : 'Start Using Bol AI'}
                <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
