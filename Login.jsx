import React, { useEffect, useState } from "react";

/**
 * AuthLoginPage.jsx
 * Single-file React component (Next.js friendly) that implements:
 * - Full /auth/login UI
 * - Credential login form with client validation
 * - Password strength indicator
 * - CAPTCHA integration (Google reCAPTCHA v2/invisible or v3 style)
 * - Social login via popup (Google / GitHub) with polling
 * - Session persistence (localStorage + optional sessionStorage)
 *
 * Server endpoints expected:
 *  - POST /api/auth/login         { email, password, captchaToken? } -> { token, user }
 *  - GET  /api/auth/oauth/:provider -> server-side OAuth redirect
 *  - GET  /api/auth/session       -> returns session after social OAuth completes
 *
 * Note: prefer server-set HttpOnly cookie for real security; localStorage is used here for SPA convenience.
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function calcPasswordScore(pw) {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score >= 5) return 4;
  return Math.max(0, score - 1);
}

function strengthLabel(score) {
  switch (score) {
    case 0: return "Very weak";
    case 1: return "Weak";
    case 2: return "Fair";
    case 3: return "Good";
    case 4: return "Strong";
    default: return "";
  }
}

export default function AuthLoginPage() {
  const recaptchaSiteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY || "";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [pwScore, setPwScore] = useState(0);
  const [captchaToken, setCaptchaToken] = useState(null);
  const [infoMessage, setInfoMessage] = useState(null);

  useEffect(() => {
    setPwScore(calcPasswordScore(password));
  }, [password]);

  useEffect(() => {
    if (!recaptchaSiteKey) return;
    if (!document.querySelector(`#recaptcha-script`)) {
      const s = document.createElement("script");
      s.id = "recaptcha-script";
      s.src = `https://www.google.com/recaptcha/api.js?render=${recaptchaSiteKey}`;
      s.async = true;
      document.head.appendChild(s);
    }
  }, [recaptchaSiteKey]);

  const validate = () => {
    const e = {};
    if (!email) e.email = "Email is required";
    else if (!EMAIL_REGEX.test(email)) e.email = "Enter a valid email";
    if (!password) e.password = "Password is required";
    else if (password.length < 6) e.password = "Password must be at least 6 characters";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const saveSession = (token, user) => {
    if (!token) return;
    try {
      if (remember) {
        localStorage.setItem("auth_token", token);
        localStorage.setItem("auth_user", JSON.stringify(user || {}));
      } else {
        sessionStorage.setItem("auth_token", token);
        sessionStorage.setItem("auth_user", JSON.stringify(user || {}));
      }
    } catch (err) {
      console.warn("Could not persist auth token", err);
    }
  };

  async function runRecaptchaAction(action = "login") {
    if (!recaptchaSiteKey) return null;
    if (!window.grecaptcha || !window.grecaptcha.ready) {
      return new Promise((resolve) => {
        let attempts = 0;
        const t = setInterval(() => {
          if (window.grecaptcha && window.grecaptcha.execute) {
            clearInterval(t);
            window.grecaptcha.execute(recaptchaSiteKey, { action }).then((token) => resolve(token)).catch(() => resolve(null));
          }
          attempts++;
          if (attempts > 20) {
            clearInterval(t);
            resolve(null);
          }
        }, 200);
      });
    }
    return window.grecaptcha.execute(recaptchaSiteKey, { action }).catch(() => null);
  }

  const submit = async (e) => {
    e?.preventDefault();
    setInfoMessage(null);
    if (!validate()) return;
    setLoading(true);
    setErrors({});

    try {
      let token = null;
      if (recaptchaSiteKey) {
        token = await runRecaptchaAction("login");
        setCaptchaToken(token);
      }

      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, captchaToken: token }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrors({ form: json.message || "Login failed" });
        setLoading(false);
        return;
      }
      saveSession(json.token, json.user);
      setInfoMessage("Login successful — redirecting...");
      setTimeout(() => { window.location.href = "/"; }, 700);
    } catch (err) {
      console.error(err);
      setErrors({ form: "Network error — try again" });
    } finally {
      setLoading(false);
    }
  };

  // Social login popup helper
  const socialLogin = (provider) => {
    const popup = window.open(`/api/auth/oauth/${provider}`, "oauth_popup", "width=600,height=700");
    if (!popup) {
      setErrors({ form: "Please allow popups for this site to use social login" });
      return;
    }

    const onMessage = async (event) => {
      if (event.data && event.data.type === "oauth-success") {
        window.removeEventListener("message", onMessage);
        await finalizeSocialLogin();
        popup.close();
      }
    };
    window.addEventListener("message", onMessage);

    const poll = setInterval(async () => {
      if (popup.closed) {
        clearInterval(poll);
        window.removeEventListener("message", onMessage);
        await finalizeSocialLogin();
      }
    }, 500);
  };

  async function finalizeSocialLogin() {
    try {
      setLoading(true);
      const r = await fetch("/api/auth/session");
      if (!r.ok) {
        setErrors({ form: "Social login failed" });
        return;
      }
      const j = await r.json();
      saveSession(j.token, j.user);
      setInfoMessage("Social login successful — redirecting...");
      setTimeout(() => (window.location.href = "/"), 600);
    } catch (err) {
      setErrors({ form: "Could not complete social login" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="max-w-lg w-full bg-white shadow-xl rounded-2xl p-8">
        <h1 className="text-2xl font-semibold mb-1">Sign in to your account</h1>
        <p className="text-sm text-gray-500 mb-6">Use your email or continue with a social account.</p>

        <div className="grid grid-cols-2 gap-3 mb-6">
          <button
            onClick={() => socialLogin("google")}
            className="flex items-center justify-center gap-2 py-2 px-3 rounded-lg border hover:shadow-sm"
            aria-label="Sign in with Google"
          >
            {/* Google svg */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M21.6 12.2275c0-.825-.0733-1.6166-.2108-2.374H12v4.503h5.844c-.2516 1.35-1.0166 2.4966-2.1666 3.266v2.716h3.5c2.0483-1.8875 3.22-4.6666 3.22-8.1116z" fill="#4285F4" />
              <path d="M12 22c2.7 0 4.9666-.9 6.6225-2.4333l-3.5-2.7166c-.9666.6483-2.2 1.0333-3.1225 1.0333-2.3966 0-4.4241-1.62-5.1466-3.8H2.86v2.3833C4.5166 19.9666 7.0083 22 12 22z" fill="#34A853" />
              <path d="M6.8534 13.0833c-.2166-.65-.3416-1.34-.3416-2.0433 0-.7033.125-1.3933.3416-2.0433V6.6133H2.86C1.9767 8.0916 1.5 9.7333 1.5 11.54s.4767 3.4484 1.36 4.9267l3.0-3.3834z" fill="#FBBC05" />
              <path d="M12 4.58c1.4683 0 2.7933.5033 3.8333 1.4867l2.875-2.875C16.965 1.4433 14.7.5 12 .5 7.0083.5 4.5166 2.5333 2.86 4.9867l3.9934 2.5966C7.5759 6.2 9.6034 4.58 12 4.58z" fill="#EA4335" />
            </svg>
            <span className="text-sm">Google</span>
          </button>

          <button
            onClick={() => socialLogin("github")}
            className="flex items-center justify-center gap-2 py-2 px-3 rounded-lg border hover:shadow-sm"
            aria-label="Sign in with GitHub"
          >
            {/* GitHub svg */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 .5C5.373.5 0 5.873 0 12.5c0 5.292 3.438 9.773 8.205 11.363.6.112.82-.263.82-.583 0-.288-.01-1.05-.016-2.06-3.338.726-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.757-1.333-1.757-1.09-.744.082-.729.082-.729 1.205.085 1.84 1.237 1.84 1.237 1.07 1.835 2.807 1.305 3.492.998.108-.776.418-1.305.762-1.605-2.665-.305-5.467-1.332-5.467-5.93 0-1.31.468-2.38 1.235-3.22-.124-.304-.535-1.527.117-3.182 0 0 1.008-.323 3.3 1.23a11.51 11.51 0 013.003-.404c1.02.005 2.047.138 3.003.404 2.29-1.553 3.296-1.23 3.296-1.23.654 1.655.243 2.878.12 3.182.77.84 1.232 1.91 1.232 3.22 0 4.61-2.807 5.62-5.48 5.92.43.37.814 1.1.814 2.22 0 1.604-.014 2.896-.014 3.29 0 .322.216.7.825.58C20.565 22.27 24 17.79 24 12.5 24 5.873 18.627.5 12 .5z" />
            </svg>
            <span className="text-sm">GitHub</span>
          </button>
        </div>

        <div className="relative w-full flex items-center mb-6">
          <hr className="flex-1 border-t border-gray-200" />
          <span className="px-3 text-sm text-gray-400">or</span>
          <hr className="flex-1 border-t border-gray-200" />
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              className={`mt-1 block w-full rounded-md border p-2 outline-none focus:ring-2 focus:ring-indigo-200 ${errors.email ? "border-red-400" : "border-gray-200"}`}
              placeholder="you@company.com"
              autoComplete="email"
            />
            {errors.email && <p className="text-sm text-red-500 mt-1">{errors.email}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Password</label>
            <div className="mt-1 relative">
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                className={`block w-full rounded-md border p-2 pr-12 outline-none focus:ring-2 focus:ring-indigo-200 ${errors.password ? "border-red-400" : "border-gray-200"}`}
                placeholder="Your password"
                autoComplete="current-password"
              />
              <div className="absolute right-2 top-2 text-xs text-gray-500">{strengthLabel(pwScore)}</div>
            </div>
            {errors.password && <p className="text-sm text-red-500 mt-1">{errors.password}</p>}

            <div className="mt-2 h-2 w-full bg-gray-100 rounded overflow-hidden">
              <div
                className={`h-full transition-all duration-200 ${
                  pwScore <= 0
                    ? "w-1/5 bg-red-400"
                    : pwScore === 1
                    ? "w-2/5 bg-red-400"
                    : pwScore === 2
                    ? "w-3/5 bg-yellow-400"
                    : pwScore === 3
                    ? "w-4/5 bg-green-400"
                    : "w-full bg-green-600"
                }`}
                style={{ width: `${(pwScore / 4) * 100}%` }}
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="form-checkbox" />
              <span>Remember me</span>
            </label>
            <a href="/auth/forgot" className="text-sm text-indigo-600 hover:underline">Forgot password?</a>
          </div>

          {errors.form && <p className="text-sm text-red-500">{errors.form}</p>}
          {infoMessage && <p className="text-sm text-green-600">{infoMessage}</p>}

          <div>
            <button
              type="submit"
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 text-white py-2 px-3 hover:bg-indigo-700 disabled:opacity-60"
            >
              {loading ? (
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              ) : null}
              <span>{loading ? "Signing in..." : "Sign in"}</span>
            </button>
          </div>
        </form>

        <p className="text-xs text-gray-400 mt-4">
          By continuing you agree to our <a className="underline">Terms</a> and <a className="underline">Privacy Policy</a>.
        </p>

        <div className="mt-4 text-xs text-gray-400">
          {recaptchaSiteKey ? (
            <div>reCAPTCHA enabled (site key detected)</div>
          ) : (
            <div className="text-gray-300">reCAPTCHA not configured. Set NEXT_PUBLIC_RECAPTCHA_SITE_KEY to enable.</div>
          )}
        </div>
      </div>
    </div>
  );
}
