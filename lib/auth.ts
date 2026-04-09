import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";
import { NextRequest } from "next/server";

const SESSION_COOKIE_NAME = "ai-key-vault-session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const CAPTCHA_TTL_SECONDS = 60 * 5;

type SignedTokenPayload = {
  type: "session" | "captcha";
  exp: number;
  username?: string;
  answer?: string;
  nonce?: string;
};

export type SessionUser = {
  username: string;
};

function readConfiguredValue(name: string): string {
  const directValue = process.env[name];
  if (typeof directValue === "string" && directValue.trim() !== "") {
    return directValue;
  }

  const encodedValue = process.env[`${name}_B64`];
  if (typeof encodedValue === "string" && encodedValue.trim() !== "") {
    try {
      return Buffer.from(encodedValue, "base64").toString("utf8");
    } catch {
      throw new Error(`Invalid base64 value for environment variable: ${name}_B64`);
    }
  }

  throw new Error(`Missing required environment variable: ${name} or ${name}_B64`);
}

function requireConfiguredValue(name: string): string {
  const value = readConfiguredValue(name);
  if (value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name} or ${name}_B64`);
  }

  return value;
}

function getAuthSecret(): string {
  return requireConfiguredValue("AUTH_SECRET").trim();
}

function signPayload(payloadSegment: string): string {
  return createHmac("sha256", getAuthSecret()).update(payloadSegment).digest("base64url");
}

function encodeToken(payload: SignedTokenPayload): string {
  const payloadSegment = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = signPayload(payloadSegment);
  return `${payloadSegment}.${signature}`;
}

function decodeToken(token: string): SignedTokenPayload | null {
  const [payloadSegment, signature] = token.split(".");
  if (!payloadSegment || !signature) return null;

  const expectedSignature = signPayload(payloadSegment);
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  const actualBuffer = Buffer.from(signature, "utf8");
  if (expectedBuffer.length !== actualBuffer.length) return null;
  if (!timingSafeEqual(expectedBuffer, actualBuffer)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8")) as SignedTokenPayload;
    if (!parsed || typeof parsed !== "object") return null;
    if ((parsed.type !== "session" && parsed.type !== "captcha") || typeof parsed.exp !== "number") return null;
    if (Date.now() >= parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getBootstrapUsername(): string {
  return requireConfiguredValue("DEFAULT_USERNAME").trim();
}

export function getBootstrapPassword(): string {
  return requireConfiguredValue("DEFAULT_PASSWORD");
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [scheme, salt, expectedHash] = storedHash.split("$");
  if (scheme !== "scrypt" || !salt || !expectedHash) return false;

  const actualHash = scryptSync(password, salt, 64).toString("hex");
  const expectedBuffer = Buffer.from(expectedHash, "hex");
  const actualBuffer = Buffer.from(actualHash, "hex");

  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

export function createSessionToken(username: string): string {
  return encodeToken({
    type: "session",
    username,
    exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
  });
}

export function getSessionCookieName(): string {
  return SESSION_COOKIE_NAME;
}

export function getSessionCookieMaxAge(): number {
  return SESSION_MAX_AGE_SECONDS;
}

export function verifySessionToken(token: string): SessionUser | null {
  const payload = decodeToken(token);
  if (!payload || payload.type !== "session" || typeof payload.username !== "string" || !payload.username.trim()) {
    return null;
  }

  return {
    username: payload.username.trim(),
  };
}

export function getSessionFromRequest(request: NextRequest): SessionUser | null {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export async function getServerSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export function createCaptchaChallenge(): { prompt: string; token: string } {
  const left = Math.floor(Math.random() * 9) + 1;
  const right = Math.floor(Math.random() * 9) + 1;
  const answer = String(left + right);

  return {
    prompt: `${left} + ${right} = ?`,
    token: encodeToken({
      type: "captcha",
      answer,
      nonce: randomBytes(8).toString("hex"),
      exp: Date.now() + CAPTCHA_TTL_SECONDS * 1000,
    }),
  };
}

export function verifyCaptchaToken(token: string, answer: string): boolean {
  const payload = decodeToken(token);
  if (!payload || payload.type !== "captcha" || typeof payload.answer !== "string") return false;
  return payload.answer === answer.trim();
}
