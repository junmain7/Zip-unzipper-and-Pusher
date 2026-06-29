import Providers from "./providers";

export const metadata = {
  title: "ZIP → GitHub Pusher",
  description: "Mobile se ZIP upload karo, directly GitHub par push karo",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
