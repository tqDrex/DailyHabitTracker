import { BrowserRouter, Routes, Route } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import CalendarPage from './pages/CalendarPage';
import SignupPage  from './pages/SignUpPage';
import ToDoPage from './pages/ToDoPage';
import ChangePasswordPage from "./pages/ChangePasswordPage";
import StudySessionPlanner from "./pages/StudySessionPlanner";

import TestPage from './pages/test';

function App() {
  return (
    
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/signup" element={<SignUpPage />} />
        <Route path="/todo" element={<ToDoPage />} />
        <Route path="/study" element={<StudySessionPlanner />} />
        <Route path="/change-password" element={<ChangePasswordPage />} />
        <Route path="/test" element={<TestPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
