import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import client from '../api/client';
import { X, Loader2, ChevronDown } from 'lucide-react';
import CountryList from 'country-list-with-dial-code-and-flag';

const countries: any[] = CountryList.getAll();

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
  const { login } = useAuth();
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [selectedCountry, setSelectedCountry] = useState(countries.find(c => c.code === 'IN') || countries[0]);
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSendOtp = () => {
      if (!phone || phone.length < 5) {
          setError('Please enter a valid mobile number');
          return;
      }
      // Since this is a hard-coded static OTP, we don't actually need to 
      // trigger an SMS sending API. We just move directly to the prompt.
      setStep('otp');
      setError('');
  };

  const handleVerifyOtp = async () => {
      if (!otp || otp.length < 6) {
          setError('Please enter a valid OTP');
          return;
      }
      setLoading(true);
      setError('');
      
      const cleanDialCode = selectedCountry.dialCode.replace(/\D/g, '');
      const formattedPhone = `+${cleanDialCode}${phone}`;
      
      try {
          const response = await client.post('/verify-otp', { 
            mobile_number: formattedPhone,
            otp: otp 
          });
          login(response.data.access_token);
          setLoading(false);
          // Reset internal state in case they open it again
          setStep('phone');
          setPhone('');
          setOtp('');
          onClose();
      } catch(err: any) {
          setLoading(false);
          setError(err.response?.data?.detail || 'Invalid OTP');
      }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
       <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
       <div className="relative w-full max-w-md rounded-2xl bg-[#09090b] border border-zinc-800 p-8 shadow-2xl">
           <button onClick={onClose} className="absolute right-4 top-4 text-zinc-400 hover:text-white transition-colors">
               <X size={20} />
           </button>
           
           <h2 className="text-2xl font-bold text-white mb-2">Login / Sign Up</h2>
           <p className="text-zinc-400 mb-6 text-sm">Enter your phone number to continue</p>
           
           {error && <div className="mb-6 text-red-400 text-sm bg-red-400/10 p-3 rounded-lg border border-red-400/20">{error}</div>}
           
           {step === 'phone' ? (
               <div className="space-y-5">
                   <div>
                       <label className="block text-zinc-400 text-xs uppercase tracking-wider mb-2 font-semibold">Mobile Number</label>
                       <div className="flex bg-zinc-900 border border-zinc-700 rounded-xl overflow-hidden focus-within:border-blue-500 transition-colors">
                           <div className="relative flex items-center px-3 border-r border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 transition-colors cursor-pointer group w-28 shrink-0">
                               <select 
                                   className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                   value={selectedCountry.code}
                                   onChange={(e) => setSelectedCountry(countries.find((c: any) => c.code === e.target.value) || countries[0])}
                               >
                                   {countries.map((c: any) => (
                                       <option key={c.code} value={c.code} className="bg-zinc-900 text-white">
                                           {c.name} ({c.dialCode})
                                       </option>
                                   ))}
                               </select>
                               <div className="flex items-center justify-between w-full pointer-events-none">
                                   <span className="text-base">{selectedCountry.flag}</span>
                                   <span className="text-zinc-300 text-sm font-medium ml-1">{selectedCountry.dialCode}</span>
                                   <ChevronDown size={14} className="text-zinc-500 group-hover:text-zinc-300 transition-colors ml-1" />
                               </div>
                           </div>
                           <input 
                               type="tel"
                               value={phone}
                               onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 15))}
                               placeholder="Enter mobile number"
                               className="w-full bg-transparent px-4 py-3.5 text-white outline-none font-medium"
                               autoFocus
                               onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && handleSendOtp()}
                           />
                       </div>
                   </div>
                   
                   <button 
                       onClick={handleSendOtp}
                       disabled={loading || phone.length < 10}
                       className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 text-white font-medium py-3.5 rounded-xl transition-colors flex items-center justify-center shadow-lg shadow-blue-500/20"
                   >
                       {loading ? <Loader2 size={20} className="animate-spin" /> : 'Get OTP'}
                   </button>
               </div>
           ) : (
               <div className="space-y-5">
                   <div>
                       <label className="block text-zinc-400 text-xs uppercase tracking-wider mb-2 font-semibold text-center">Enter OTP</label>
                       <div className="mb-4">
                           <input
                               type="text"
                               maxLength={6}
                               value={otp}
                               onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                               onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                                   if (e.key === 'Enter' && otp.length >= 6) {
                                       handleVerifyOtp();
                                   }
                               }}
                               placeholder="Enter 6-digit OTP"
                               className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-4 text-white outline-none focus:border-blue-500 transition-colors text-center text-xl tracking-[0.25em] sm:tracking-[0.5em] font-medium"
                               autoFocus
                           />
                       </div>
                   </div>
                   
                   <button 
                       onClick={handleVerifyOtp}
                       disabled={loading || otp.length < 6}
                       className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:hover:bg-emerald-600 text-white font-medium py-3.5 rounded-xl transition-colors flex items-center justify-center shadow-lg shadow-emerald-500/20"
                   >
                       {loading ? <Loader2 size={20} className="animate-spin" /> : 'Verify & Login'}
                   </button>
                   
                   <button 
                       onClick={() => { setStep('phone'); setOtp(''); setError(''); }}
                       className="w-full text-zinc-400 hover:text-white text-sm mt-2 py-2 transition-colors"
                   >
                       Change phone number
                   </button>
               </div>
           )}
       </div>
    </div>
  );
};
