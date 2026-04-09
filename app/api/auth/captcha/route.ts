import { NextResponse } from "next/server";

import { createCaptchaChallenge } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(createCaptchaChallenge());
}
