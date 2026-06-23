export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  try {
    if (action === "chat") {
      const body = await request.json();
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 8000,
          system: body.system,
          messages: body.messages,
        }),
      });
      const data = await response.json();
      return new Response(JSON.stringify(data), { headers });
    }

    if (action === "save") {
      const body = await request.json();
      const response = await fetch(`https://api.github.com/gists/${env.GIST_ID}`, {
        method: "PATCH",
        headers: {
          "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
          "Content-Type": "application/json",
          "User-Agent": "franck-cuisto",
        },
        body: JSON.stringify({
          files: {
            "franck-cuisto.json": {
              content: JSON.stringify(body.data, null, 2),
            },
          },
        }),
      });
      const data = await response.json();
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    if (action === "load") {
      const response = await fetch(`https://api.github.com/gists/${env.GIST_ID}`, {
        headers: {
          "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
          "User-Agent": "franck-cuisto",
        },
      });
      const data = await response.json();
      const content = data.files?.["franck-cuisto.json"]?.content || "{}";
      return new Response(content, { headers });
    }

    return new Response(JSON.stringify({ error: "Action inconnue" }), { status: 400, headers });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}
