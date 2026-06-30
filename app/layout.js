import Providers from "./providers";

export const metadata = {
  title: "ZIP → GitHub Pusher",
  description: "Mobile se ZIP upload karo, directly GitHub par push karo",
  manifest: "/manifest.json",
  themeColor: "#3b9eff",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ZipPusher",
  },
  icons: {
    icon: "/icon-192.png",
    apple: "/icon-192.png",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <Providers>{children}</Providers>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', () => {
                  navigator.serviceWorker.register('/sw.js').catch(() => {});
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
