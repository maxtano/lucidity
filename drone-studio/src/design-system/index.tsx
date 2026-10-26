import type { ButtonHTMLAttributes, HTMLAttributes } from 'react';
import './tokens.css';
import './primitives.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'feature';
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'feature';
export function Button({ variant = 'secondary', size = 'md', className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' | 'lg' }) {
  return <button {...props} type={type} className={`ds-button ${className}`} data-variant={variant} data-size={size} />;
}
export function Badge({ tone = 'neutral', className = '', ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return <span {...props} className={`ds-badge ${className}`} data-tone={tone} />;
}
export function Notice({ tone = 'info', className = '', ...props }: HTMLAttributes<HTMLDivElement> & { tone?: Tone }) {
  // Callers choose role=alert/status for newly arriving messages; decorative guidance is not live.
  return <div {...props} className={`ds-notice ${className}`} data-tone={tone} />;
}
export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`ds-card ${className}`} />;
}
