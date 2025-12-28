import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiService } from '@/services/api';

interface AuthContextType {
  isAuthenticated: boolean;
  login: (apiKey: string, remember?: boolean) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const apiKey = apiService.getApiKey();
    if (apiKey) {
      validateApiKey(apiKey);
    }
  }, []);

  const validateApiKey = async (apiKey: string) => {
    try {
      apiService.setApiKey(apiKey);
      await apiService.getConfig();
      setIsAuthenticated(true);
    } catch (error) {
      apiService.clearApiKey();
      setIsAuthenticated(false);
    }
  };

  const login = async (apiKey: string, remember = false) => {
    apiService.setApiKey(apiKey);
    if (remember) {
      localStorage.setItem('apiKey', apiKey);
    }
    await apiService.getConfig();
    setIsAuthenticated(true);
  };

  const logout = () => {
    apiService.clearApiKey();
    setIsAuthenticated(false);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
