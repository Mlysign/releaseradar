"use client";
import ToastProvider from "@/components/ui/Toast";
import ConfirmProvider from "@/components/ui/ConfirmDialog";

// Single client boundary mounting the app-wide UI providers (toast + confirm)
// so the server root layout can stay a Server Component (see Next.js docs:
// context providers must live in a Client Component wrapping `children`).
export default function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmProvider>{children}</ConfirmProvider>
    </ToastProvider>
  );
}
