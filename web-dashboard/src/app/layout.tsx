import type { Metadata } from "next";
import Sidebar from "@/components/Sidebar";
import AuthGate from "@/components/AuthGate";
import "./globals.css";

export const metadata: Metadata = {
  title: "DCS Server Dashboard",
  description: "Web management dashboard for DCS World server",
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="app-layout">
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundImage: 'url(/img/background.png)',
          backgroundSize: '100% 100%',
          backgroundPosition: 'center',
          zIndex: -2,
        }} />
        <AuthGate>
          <Sidebar />
          <div className="main-content">
            {children}
          </div>
        </AuthGate>
      </body>
    </html>
  );
}
