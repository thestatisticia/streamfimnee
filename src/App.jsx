import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import StreamFiDapp from './components/StreamFiDapp'
import './App.css'

function App() {
  return (
    <Router>
      <div className="app">
        <Routes>
          <Route path="/" element={<StreamFiDapp />} />
          <Route path="/create" element={<StreamFiDapp defaultTab="create" />} />
          <Route path="/streams" element={<StreamFiDapp defaultTab="my-streams" />} />
          <Route path="/claim" element={<StreamFiDapp defaultTab="claim" />} />
          <Route path="/analytics" element={<StreamFiDapp defaultTab="analytics" />} />
          <Route path="/buy-sell" element={<StreamFiDapp defaultTab="buy-sell" />} />
          <Route path="/admin" element={<StreamFiDapp defaultTab="admin" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </Router>
  )
}

export default App
