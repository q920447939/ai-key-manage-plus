"use client";

import { useEffect, useState } from "react";

type CaptchaPayload = {
  prompt: string;
  token: string;
};

async function fetchCaptcha(): Promise<CaptchaPayload> {
  const response = await fetch("/api/auth/captcha", {
    method: "GET",
    cache: "no-store",
  });
  const payload = (await response.json()) as Partial<CaptchaPayload> & { message?: string };

  if (!response.ok || typeof payload.prompt !== "string" || typeof payload.token !== "string") {
    throw new Error(payload.message || "验证码加载失败");
  }

  return {
    prompt: payload.prompt,
    token: payload.token,
  };
}

export default function LoginClient() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [captchaPrompt, setCaptchaPrompt] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [loadingCaptcha, setLoadingCaptcha] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function refreshCaptcha(options?: { clearError?: boolean }): Promise<boolean> {
    const clearError = options?.clearError ?? true;
    setLoadingCaptcha(true);
    if (clearError) {
      setError("");
    }

    try {
      const nextCaptcha = await fetchCaptcha();
      setCaptchaPrompt(nextCaptcha.prompt);
      setCaptchaToken(nextCaptcha.token);
      setCaptchaAnswer("");
      return true;
    } catch (captchaError) {
      if (clearError) {
        setError(captchaError instanceof Error ? captchaError.message : "验证码加载失败");
      }
      return false;
    } finally {
      setLoadingCaptcha(false);
    }
  }

  useEffect(() => {
    void refreshCaptcha();
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!captchaToken) {
      setError("验证码尚未就绪");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username,
          password,
          captchaAnswer,
          captchaToken,
        }),
      });

      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        const nextError = payload.message || "登录失败";
        const captchaRefreshed = await refreshCaptcha({ clearError: false });
        setError(captchaRefreshed ? nextError : `${nextError}；验证码刷新失败，请手动重试`);
        return;
      }

      window.location.href = "/";
    } catch {
      const nextError = "登录失败，请稍后再试";
      const captchaRefreshed = await refreshCaptcha({ clearError: false });
      setError(captchaRefreshed ? nextError : `${nextError}；验证码刷新失败，请手动重试`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#dff7e7,_#f4f4f5_55%,_#ffffff)] px-4 py-10 text-zinc-900">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl items-center justify-center">
        <section className="grid w-full max-w-4xl overflow-hidden rounded-[32px] border border-emerald-100 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.12)] md:grid-cols-[1.1fr_0.9fr]">
          <div className="bg-zinc-950 px-8 py-10 text-white">
            <p className="text-sm uppercase tracking-[0.24em] text-emerald-300">AI Key Vault</p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight">SQLite 化的私有 Key 管理台</h1>
          </div>

          <div className="px-6 py-8 sm:px-8 sm:py-10">
            <div className="mx-auto max-w-sm">
              <h2 className="text-2xl font-semibold tracking-tight text-zinc-900">登录</h2>

              <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-zinc-700">用户名</span>
                  <input
                    className="w-full rounded-2xl border border-zinc-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    autoComplete="username"
                    placeholder="输入你部署时设置的用户名"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-zinc-700">密码</span>
                  <input
                    type="password"
                    className="w-full rounded-2xl border border-zinc-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="current-password"
                    placeholder="输入你部署时设置的密码"
                  />
                </label>

                <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-zinc-700">验证码</span>
                    <input
                      className="w-full rounded-2xl border border-zinc-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                      value={captchaAnswer}
                      onChange={(event) => setCaptchaAnswer(event.target.value)}
                      inputMode="numeric"
                    />
                  </label>

                  <button
                    type="button"
                    className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-zinc-300 bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => void refreshCaptcha()}
                    disabled={loadingCaptcha || submitting}
                  >
                    {loadingCaptcha ? "加载中..." : captchaPrompt || "刷新验证码"}
                  </button>
                </div>

                {error ? <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

                <button
                  type="submit"
                  className="inline-flex w-full items-center justify-center rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={submitting || loadingCaptcha}
                >
                  {submitting ? "登录中..." : "进入控制台"}
                </button>
              </form>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
