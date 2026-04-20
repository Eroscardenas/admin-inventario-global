'use client';

import { ReactNode } from 'react';
import {useAuthContext } from '@/context/AuthContext';
import { InventoryProvider } from '@/context/InventoryContext';

interface AppProvidersProps {
  children: ReactNode;
}

export default function AppProviders({ children }: AppProvidersProps) {
  return (
      <InventoryProvider>
        {children}
      </InventoryProvider>
  );
}