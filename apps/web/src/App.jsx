import { Box } from '@mui/material';
import { Route, Routes } from 'react-router-dom';
import Navbar from './components/Navbar';
import ErrorBoundary from './components/ErrorBoundary';
import { AthleteDataProvider } from './hooks/useAthleteData';
import { SettingsProvider } from './context/SettingsContext';
import Dashboard from './pages/Dashboard';
import Activities from './pages/Activities';
import Analytics from './pages/Analytics';
import Records from './pages/Records';
import TrainingPlan from './pages/TrainingPlan';
import Profile from './pages/Profile';
import Login from './pages/Login';

export default function App() {
  return (
    <ErrorBoundary>
      <SettingsProvider>
        <AthleteDataProvider>
          <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
            <Navbar />
            <Box component="main" sx={{ flexGrow: 1, p: 3, maxWidth: 1400, mx: 'auto', width: '100%' }}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/activities" element={<Activities />} />
                <Route path="/analytics" element={<Analytics />} />
                <Route path="/records" element={<Records />} />
                <Route path="/training" element={<TrainingPlan />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/login" element={<Login />} />
              </Routes>
            </Box>
          </Box>
        </AthleteDataProvider>
      </SettingsProvider>
    </ErrorBoundary>
  );
}
