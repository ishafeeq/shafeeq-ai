import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, LogOut, User, Edit2, Check, X } from 'lucide-react';
import client from '../api/client';

export const Profile: React.FC = () => {
  const { user, logout, fetchUser } = useAuth();
  const navigate = useNavigate();
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(user?.full_name || '');
  const [isSaving, setIsSaving] = useState(false);

  React.useEffect(() => {
    fetchUser();
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const handleSaveName = async () => {
    if (!editName.trim()) return;
    setIsSaving(true);
    try {
      await client.put('/users/me', { full_name: editName });
      // In a real app we would update the user context here, but reloading simplifies it for now
      window.location.reload(); 
    } catch (err) {
      console.error('Failed to update name', err);
      setIsSaving(false);
    }
  };

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#09090b] text-white">
        <p>Please login to view profile.</p>
      </div>
    );
  }

  const displayName = user.full_name || 'No Name';

  return (
    <div className="flex-1 w-full bg-[#09090b] p-4 sm:p-8 text-zinc-100 flex items-center justify-center overflow-y-auto">
      <div className="w-full max-w-md py-8">
        <button 
          onClick={() => navigate('/')}
          className="mb-6 flex items-center gap-2 text-zinc-400 hover:text-white transition-colors"
        >
          <ArrowLeft size={18} />
          Back to Shafeeq-AI
        </button>

        <div className="rounded-3xl bg-[#09090b] border border-zinc-800 shadow-2xl p-6 sm:p-8">
          <div className="mb-8 flex flex-col items-center text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/20 mb-4">
              <User size={36} />
            </div>
            
            {isEditing ? (
              <div className="flex items-center gap-2 mb-1">
                <input 
                  type="text" 
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-blue-500 w-48 text-center"
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
                />
                <button 
                  onClick={handleSaveName}
                  disabled={isSaving}
                  className="p-1.5 bg-green-500/10 text-green-400 rounded-md hover:bg-green-500/20 transition-colors"
                >
                  <Check size={16} />
                </button>
                <button 
                  onClick={() => setIsEditing(false)}
                  className="p-1.5 bg-zinc-800 text-zinc-400 rounded-md hover:bg-zinc-700 transition-colors"
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 group mb-1 justify-center">
                <h1 className="text-2xl font-bold text-white">{displayName}</h1>
                <button 
                  onClick={() => setIsEditing(true)}
                  className="text-zinc-500 hover:text-blue-400 transition-colors"
                  title="Edit Name"
                >
                  <Edit2 size={16} />
                </button>
              </div>
            )}
            
            {/* Show setup prompt if no name exists and not editing */}
            {!user.full_name && !isEditing && (
               <button 
                 onClick={() => setIsEditing(true)}
                 className="text-xs text-blue-400 hover:text-blue-300 mt-1"
               >
                 + Enter your name
               </button>
            )}

            <p className="text-zinc-400 mt-2">{user.mobile_number}</p>
          </div>

          <div className="mb-8 space-y-3">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
              <p className="text-xs text-zinc-500 uppercase tracking-wider font-semibold mb-1">Current Plan</p>
              <p className="text-lg font-medium text-white capitalize">{user.plan_type}</p>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
              <p className="text-xs text-zinc-500 uppercase tracking-wider font-semibold mb-1">Credits Balance</p>
              <p className="text-lg font-medium text-white flex items-center gap-2">
                <span className="text-blue-400 font-bold">{user.credits_balance}</span> Credits
              </p>
            </div>
          </div>

          <button 
            onClick={handleLogout}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3.5 text-red-400 hover:bg-red-500/20 transition-colors font-medium"
          >
            <LogOut size={18} />
            Logout
          </button>
        </div>
      </div>
    </div>
  );
};
