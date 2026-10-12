"use client";

import { Eye, EyeOff, LogIn } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { LoginOverlay } from "@/components/auth/LoginOverlay";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Form";
import { useToast } from "@/components/ui/Toast";
import { ApiClientError, apiPost } from "@/lib/api/client";

const ENTER_DELAY_MS = 1700;
const ENTER_FALLBACK_MS = 6000;

export function LoginForm({
  initialError,
  nextPath,
}: {
  initialError?: string | null;
  nextPath: string;
}) {
  const router = useRouter();
  const toast = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<"idle" | "entering">("idle");
  const enterTimer = useRef<number | null>(null);
  const fallbackTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (enterTimer.current) window.clearTimeout(enterTimer.current);
      if (fallbackTimer.current) window.clearTimeout(fallbackTimer.current);
    };
  }, []);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError("Email dan password wajib diisi");
      return;
    }

    setLoading(true);
    try {
      const result = await apiPost<{ user: { username: string; role: string } }>(
        "/api/auth/login",
        { email: email.trim(), password },
      );
      toast.success(`Selamat datang, ${result.user.username}`);
      const target =
        nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/dashboard";

      setPhase("entering");
      enterTimer.current = window.setTimeout(() => {
        router.replace(target);
        router.refresh();
      }, ENTER_DELAY_MS);
      fallbackTimer.current = window.setTimeout(() => {
        window.location.href = target;
      }, ENTER_FALLBACK_MS);
    } catch (loginError) {
      const message =
        loginError instanceof ApiClientError ? loginError.message : "Gagal login. Coba lagi.";
      setError(message);
      setLoading(false);
    }
  };

  return (
    <>
      {phase === "entering" ? <LoginOverlay /> : null}
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Email" htmlFor="email" required>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="nama@email.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            invalid={Boolean(error)}
            required
          />
        </Field>

        <Field label="Password" htmlFor="password" required>
          <div className="relative">
            <Input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              invalid={Boolean(error)}
              className="pr-10"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((previous) => !previous)}
              aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-control p-1.5 text-muted transition-colors duration-150 hover:bg-surface-raised hover:text-text"
            >
              {showPassword ? (
                <EyeOff size={16} strokeWidth={1.5} />
              ) : (
                <Eye size={16} strokeWidth={1.5} />
              )}
            </button>
          </div>
        </Field>

        {error ? (
          <p
            role="alert"
            className="rounded-control border border-banned/40 bg-banned/10 px-3 py-2 text-label text-banned"
          >
            {error}
          </p>
        ) : null}

        <Button
          type="submit"
          variant="primary"
          loading={loading}
          className="w-full"
          icon={<LogIn size={16} strokeWidth={1.5} />}
        >
          Login
        </Button>
      </form>
    </>
  );
}
