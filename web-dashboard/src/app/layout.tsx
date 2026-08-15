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
        <video 
          autoPlay loop muted playsInline 
          style={{
            position: 'fixed',
            inset: 0,
            width: '100vw',
            height: '100vh',
            objectFit: 'cover',
            zIndex: -1,
            opacity: 0.15,
            pointerEvents: 'none'
          }}
        >
          <source src="/media/background.mp4" type="video/mp4" />
        </video>
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
