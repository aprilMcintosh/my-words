export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { text, lang } = await req.json();
  if (!text || typeof text !== "string" || text.length > 500) {
    return new Response(JSON.stringify({ error: "Invalid text" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const VOICES = {
    es: "zl1Ut8dvwcVSuQSB9XkG",
    jp: "XB0fDUnXU5powFXDhCwa",
  };
  const VOICE_ID = VOICES[lang] || VOICES.es;
  const API_KEY = process.env.ELEVENLABS_API_KEY;

  if (!API_KEY) {
    return new Response(JSON.stringify({ error: "TTS not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": API_KEY,
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: { stability: 0.75, similarity_boost: 0.85, style: 0.0 },
        }),
      }
    );

    if (!response.ok) {
      return new Response(JSON.stringify({ error: "ElevenLabs API error" }), {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    const arrayBuffer = await response.arrayBuffer();
    return new Response(arrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "TTS failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
