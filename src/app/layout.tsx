import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Footer from "@/components/Footer";
import ToastProvider from "@/components/ToastProvider";
// Removed AccountMenu (GitHub login not needed)

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TradeTalk by Spenn Development",
  description: "Hyperliquid Perps - New generation of COD lobbies",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              // Comprehensive iframe error suppression
              (function() {
                const originalConsoleError = console.error;
                const originalConsoleWarn = console.warn;
                
                // Suppress iframe-related console errors
                console.error = function(...args) {
                  const message = args.join(' ');
                  if (message.includes('contentWindow') || 
                      message.includes('Cannot listen to the event from the provided iframe') ||
                      message.includes('iframe') && message.includes('not available')) {
                    // Suppress iframe-related errors
                    return;
                  }
                  originalConsoleError.apply(console, args);
                };
                
                console.warn = function(...args) {
                  const message = args.join(' ');
                  if (message.includes('contentWindow') || 
                      message.includes('Cannot listen to the event from the provided iframe') ||
                      message.includes('iframe') && message.includes('not available')) {
                    // Suppress iframe-related warnings
                    return;
                  }
                  originalConsoleWarn.apply(console, args);
                };
                
                // Global error handler for iframe-related errors
                window.addEventListener('error', function(event) {
                  if (event.message && (
                    event.message.includes('contentWindow') ||
                    event.message.includes('Cannot listen to the event from the provided iframe') ||
                    event.message.includes('iframe') && event.message.includes('not available')
                  )) {
                    event.preventDefault();
                    event.stopPropagation();
                    return false;
                  }
                }, true);
                
                // Handle unhandled promise rejections
                window.addEventListener('unhandledrejection', function(event) {
                  if (event.reason && event.reason.message && (
                    event.reason.message.includes('contentWindow') ||
                    event.reason.message.includes('Cannot listen to the event from the provided iframe') ||
                    event.reason.message.includes('iframe') && event.reason.message.includes('not available')
                  )) {
                    event.preventDefault();
                    event.stopPropagation();
                  }
                });
              })();
            `,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-black text-white min-h-screen`}
      >
        <div className="min-h-screen bg-black flex flex-col">
          <div className="sticky top-0 z-40 border-b border-white/10 bg-black" />
          <div className="flex-1">{children}</div>
          <Footer />
          <ToastProvider />
        </div>
      </body>
    </html>
  );
}
