import type { MouseEvent } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import HomePage from './pages/HomePage';
import AnalysisPage from './pages/AnalysisPage';
import { UnsavedChangesProvider, useConfirmDiscard } from './unsavedChanges';

function Header() {
  const confirmDiscard = useConfirmDiscard();
  const guard = (event: MouseEvent) => {
    if (!confirmDiscard()) event.preventDefault();
  };
  return (
    <header className="app-header">
      <Link to="/" className="app-brand" onClick={guard}>
        datool
      </Link>
      <span className="muted">discourse analysis</span>
      <Link to="/?new=1" className="app-add" onClick={guard}>
        New analysis
      </Link>
    </header>
  );
}

export default function App() {
  return (
    <UnsavedChangesProvider>
      <div className="app">
        <Header />
        <main className="app-main">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/analysis/:id" element={<AnalysisPage />} />
          </Routes>
        </main>
      </div>
    </UnsavedChangesProvider>
  );
}
