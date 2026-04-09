import { NextRequest, NextResponse } from "next/server";

import {
  createSessionToken,
  getSessionCookieMaxAge,
  getSessionCookieName,
  verifyCaptchaToken,
  verifyPassword,
} from "@/lib/auth";
import { getUserByUsername } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const captchaAnswer = typeof body.captchaAnswer === "string" ? body.captchaAnswer.trim() : "";
    const captchaToken = typeof body.captchaToken === "string" ? body.captchaToken.trim() : "";

    if (!username || !password || !captchaAnswer || !captchaToken) {
      return NextResponse.json({ message: "用户名、密码和验证码不能为空" }, { status: 400 });
    }

    if (!verifyCaptchaToken(captchaToken, captchaAnswer)) {
      return NextResponse.json({ message: "验证码错误或已过期" }, { status: 400 });
    }

    const user = getUserByUsername(username);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return NextResponse.json({ message: "用户名或密码错误" }, { status: 401 });
    }

    const response = NextResponse.json({ ok: true, username: user.username });
    response.cookies.set({
      name: getSessionCookieName(),
      value: createSessionToken(user.username),
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: getSessionCookieMaxAge(),
    });
    return response;
  } catch {
    return NextResponse.json({ message: "请求体不是合法 JSON" }, { status: 400 });
  }
}
