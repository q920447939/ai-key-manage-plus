import { NextRequest, NextResponse } from "next/server";

function normalizeBaseUrl(raw: string): string {
  const cleaned = raw.trim().replace(/\/+$/, "");
  if (!cleaned) return "";
  if (!/^https?:\/\//i.test(cleaned)) return `https://${cleaned}`;
  return cleaned;
}

function buildChatUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) return "";

  if (/\/chat\/completions$/i.test(normalized)) return normalized;
  if (/\/v\d+$/i.test(normalized)) return `${normalized}/chat/completions`;
  return `${normalized}/v1/chat/completions`;
}

function extractMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";

  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";

  const first = choices[0];
  if (!first || typeof first !== "object") return "";

  const message = (first as { message?: unknown }).message;
  if (!message || typeof message !== "object") return "";

  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  const text = content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const maybeText = (part as { text?: unknown }).text;
      return typeof maybeText === "string" ? maybeText : "";
    })
    .join("")
    .trim();

  return text;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      baseUrl?: string;
      apiKey?: string;
      model?: string;
    };

    const baseUrl = body.baseUrl?.trim() ?? "";
    const apiKey = body.apiKey?.trim() ?? "";
    const model = body.model?.trim() ?? "";

    if (!baseUrl || !apiKey) {
      return NextResponse.json({ ok: false, message: "地址或 Key 为空" }, { status: 400 });
    }

    const testUrl = buildChatUrl(baseUrl);
    if (!testUrl) {
      return NextResponse.json({ ok: false, message: "地址无效" }, { status: 400 });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);

    const resp = await fetch(testUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: model || "gpt-4o-mini",
        messages: [{ role: "user", content: "你好，请回复：ok" }],
        stream: false,
        max_tokens: 16
      }),
      signal: controller.signal,
      cache: "no-store"
    });

    clearTimeout(timer);

    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) {
        return NextResponse.json({ ok: false, message: "Key 无效或权限不足" });
      }
      if (resp.status === 404) {
        return NextResponse.json({ ok: false, message: "地址可达，但聊天接口不存在" });
      }
      return NextResponse.json({ ok: false, message: `请求失败（HTTP ${resp.status}）` });
    }

    const payload = (await resp.json()) as unknown;
    const message = extractMessage(payload);
    if (!message) {
      return NextResponse.json({ ok: false, message: "未返回消息内容" });
    }

    return NextResponse.json({ ok: true, message: "返回消息正常" });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json({ ok: false, message: "请求超时，请检查地址" });
    }
    return NextResponse.json({ ok: false, message: "测试异常，请检查地址格式" });
  }
}
