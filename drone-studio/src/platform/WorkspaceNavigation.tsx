import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export const WorkspaceNavigationContext = createContext<{
  target: HTMLDivElement | null;
  dismiss: () => void;
  toggle: () => void;
  expanded: boolean;
} | null>(null);

export function useWorkspaceNavigation() {
  return useContext(WorkspaceNavigationContext);
}

/** Each app owns its navigation and state; the shell supplies one shared location. */
export function WorkspaceNavigation({
  active = true,
  children,
}: {
  active?: boolean;
  children: ReactNode;
}) {
  const shell = useWorkspaceNavigation();
  if (!active) return null;
  if (!shell) return <>{children}</>;
  return shell.target ? createPortal(children, shell.target) : null;
}
