// src/app/layout.tsx
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { InventoryProvider } from "@/context/InventoryContext";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body>
        <AuthProvider>
          <InventoryProvider>{children}</InventoryProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
