import { BrowserRouter, Routes, Route } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import CalendarPage from './pages/CalendarPage';
import SignupPage  from './pages/SignUpPage';
import ToDoPage from './pages/ToDoPage';
import ChangePasswordPage from "./pages/ChangePasswordPage";


function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/todo" element={<ToDoPage />} />
        <Route path="/change-password" element={<ChangePasswordPage />} />

      </Routes>
    </BrowserRouter>
  );
}

export default App;
