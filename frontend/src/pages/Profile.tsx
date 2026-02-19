import React from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, LogOut, User } from 'lucide-react';

export const Profile: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p>Please login to view profile.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-2xl">
        <button 
          onClick={() => navigate('/')}
          className="mb-8 flex items-center gap-2 text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft size={20} />
          Back to Dashboard
        </button>

        <div className="rounded-xl bg-white p-8 shadow-sm">
          <div className="mb-8 flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
              <User size={32} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{user.full_name || 'Jeetu User'}</h1>
              <p className="text-gray-500">{user.mobile_number}</p>
            </div>
          </div>

          <div className="mb-8 space-y-4">
            <div className="rounded-lg border p-4">
              <p className="text-sm text-gray-500">Current Plan</p>
              <p className="text-lg font-medium text-gray-900">{user.plan_type}</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-sm text-gray-500">Credits Balance</p>
              <p className="text-lg font-medium text-gray-900">{user.credits_balance} Credits</p>
            </div>
          </div>

          <button 
            onClick={handleLogout}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700 hover:bg-red-100"
          >
            <LogOut size={20} />
            Logout
          </button>
        </div>
      </div>
    </div>
  );
};
