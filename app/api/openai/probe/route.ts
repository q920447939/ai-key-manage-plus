import { NextRequest, NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/auth";
import { runOpenAIProbe } from "@/lib/openai-proxy";
import type { OpenAIProxyProbeRequest } from "@/lib/openai-proxy-types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!getSessionFromRequest(request)) {
    return NextResponse.json({ message: "未登录或会话已过期" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as Partial<OpenAIProxyProbeRequest>;

    return NextResponse.json(
      await runOpenAIProbe({
        baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : "",
        apiKey: typeof body.apiKey === "string" ? body.apiKey : "",
        currentModel: typeof body.currentModel === "string" ? body.currentModel : "",
      }),
    );
  } catch {
    return NextResponse.json({ message: "请求体不是合法 JSON" }, { status: 400 });
  }
}
