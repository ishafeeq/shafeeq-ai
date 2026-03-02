import React, { createContext, useContext, useState, useEffect } from 'react';
import client from '../api/client';

interface User {
  id: number;
  mobile_number: string;
  email?: string;
  full_name?: string;
  plan_type: string;
  credits_balance: number;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (token: string) => void;
  logout: () => void;
  loading: boolean;
  guestMode: boolean;
  setGuestMode: (mode: boolean) => void;
  fetchUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);
  const [guestMode, setGuestMode] = useState(false);


  useEffect(() => {
    if (token) {
      fetchUser();
    } else {
        setLoading(false);
    }
  }, [token]);

  const fetchUser = async () => {
    try {
      const response = await client.get('/users/me');
      setUser(response.data);
    } catch (error) {
      logout();
    } finally {
      setLoading(false);
    }
  };

  const login = (newToken: string) => {
    localStorage.setItem('token', newToken);
    setToken(newToken);
  };

  const logout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, loading, guestMode, setGuestMode, fetchUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
