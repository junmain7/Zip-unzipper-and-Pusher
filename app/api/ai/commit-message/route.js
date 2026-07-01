import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";

// POST /api/ai/commit-message — old vs new file content dekh kar Groq se ek chhota commit message banata hai
export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session?.uid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { fileName, original, updated } = await request.json();
  if (!fileName || typeof updated !== "string") {
    return NextResponse.json({ error: "fileName aur updated content zaroori hai" }, { status: 400 });
  }

  const oldSnippet = (original || "").slice(0, 4000);
  const newSnippet = updated.slice(0, 4000);

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        temperature: 0.3,
        max_tokens: 40,
        messages: [
          {
            role: "system",
            content:
              "Tum ek Git commit message generator ho. File ke purane aur naye content ka farak samajh kar EK CHHOTA conventional-style commit message banao (max 10 words, English mein, jaise 'Fix login bug' ya 'Update button styles'). Sirf commit message return karo — koi quotes, prefix, ya explanation nahi.",
          },
          {
            role: "user",
            content: `File: ${fileName}\n\n--- OLD ---\n${oldSnippet}\n\n--- NEW ---\n${newSnippet}`,
          },
        ],
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "Groq error");

    const message =
      data.choices?.[0]?.message?.content?.trim().replace(/^["']|["']$/g, "") ||
      `Update ${fileName}`;
    return NextResponse.json({ message });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
