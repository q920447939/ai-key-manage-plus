import { NextRequest, NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/auth";
import { listConfigs, replaceAllConfigs } from "@/lib/db";

export const runtime = "nodejs";

function unauthorized() {
  return NextResponse.json({ message: "未登录或会话已过期" }, { status: 401 });
}

export async function GET(request: NextRequest) {
  if (!getSessionFromRequest(request)) {
    return unauthorized();
  }

  return NextResponse.json({ configs: listConfigs() });
}

export async function PUT(request: NextRequest) {
  if (!getSessionFromRequest(request)) {
    return unauthorized();
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    return NextResponse.json({
      configs: replaceAllConfigs(body.configs),
    });
  } catch {
    return NextResponse.json({ message: "请求体不是合法 JSON" }, { status: 400 });
  }
}
