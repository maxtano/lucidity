import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Showcase } from './Showcase';
import '../styles.css';
import './demo.css';

createRoot(document.getElementById('root')!).render(<StrictMode><Showcase /></StrictMode>);
