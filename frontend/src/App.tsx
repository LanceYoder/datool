import { Link, Route, Routes } from 'react-router-dom';
import HomePage from './pages/HomePage';
import AnalysisPage from './pages/AnalysisPage';

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" className="app-brand">
          datool
        </Link>
        <span className="muted">discourse analysis</span>
      </header>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/analysis/:id" element={<AnalysisPage />} />
        </Routes>
      </main>
    </div>
  );
}
