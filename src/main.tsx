import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { installBrowserConsoleCapture } from './utils/consoleCapture.ts';

installBrowserConsoleCapture();

createRoot(document.getElementById('root')!).render(<App />);
