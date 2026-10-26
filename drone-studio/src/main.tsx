import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Lucidity from './platform/Lucidity';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Lucidity />
  </StrictMode>
);
