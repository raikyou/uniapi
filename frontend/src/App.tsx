import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { LoginPage } from '@/pages/LoginPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { Toaster } from '@/components/ui/toaster';

function AppContent() {
  const { isAuthenticated } = useAuth();

  return (
    <>
      {isAuthenticated ? <DashboardPage /> : <LoginPage />}
      <Toaster />
    </>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
