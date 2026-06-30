import GoogleProvider from "next-auth/providers/google";

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      // token.sub is Google's stable user id — used as Firestore doc key
      if (account) token.uid = token.sub;
      return token;
    },
    async session({ session, token }) {
      session.uid = token.uid || token.sub;
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
};
