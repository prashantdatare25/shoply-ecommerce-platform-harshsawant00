import React, { useEffect, useState } from "react";
import { z } from "zod";

/**
 * AuthRegisterPage.tsx
 * Multi-step registration wizard (React + TypeScript + Tailwind)
 * - Step 1: Account (email, password)
 * - Step 2: Profile (name, display name, optional avatar URL)
 * - Step 3: Extras & Terms (role selection, accept terms)
 * - Zod schemas for validation per-step
 * - Email uniqueness check (calls /api/auth/check-email)
 * - Final submit to /api/auth/register
 * - Success modal shown on completion
 *
 * Server endpoints expected:
 *  - POST /api/auth/check-email  { email } -> { available: boolean }
 *  - POST /api/auth/register     { ...payload } -> { ok: true, user }
 *
 * Notes:
 *  - This is a client-side wizard. For production, perform full server-side validation too.
 *  - Tailwind classes are used for styling.
 */

// ------------------- ZOD SCHEMAS -------------------
const accountSchema = z.object({
  email: z.string().min(1, "Email is required").email("Invalid email"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128)
    .regex(/[A-Z]/, "Add at least one uppercase letter")
    .regex(/[a-z]/, "Add at least one lowercase letter")
    .regex(/\d/, "Add at least one number"),
  passwordConfirm: z.string().min(1, "Confirm your password"),
}).refine((data) => data.password === data.passwordConfirm, {
  message: "Passwords do not match",
  path: ["passwordConfirm"],
});

const profileSchema = z.object({
  fullName: z.string().min(1, "Full name is required"),
  displayName: z.string().min(1, "Display name is required"),
  avatarUrl: z.string().url("Avatar must be a valid URL").optional().or(z.literal("")),
});

const extrasSchema = z.object({
  role: z.enum(["student", "instructor", "other"]),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: "You must accept the terms" }) }),
});

// Combined type
type AccountData = z.infer<typeof accountSchema>;
type ProfileData = z.infer<typeof profileSchema>;
type ExtrasData = z.infer<typeof extrasSchema>;

export default function AuthRegisterPage() {
  const [step, setStep] = useState<number>(1);

  // Step states
  const [account, setAccount] = useState<AccountData>({ email: "", password: "", passwordConfirm: "" });
  const [profile, setProfile] = useState<ProfileData>({ fullName: "", displayName: "", avatarUrl: "" });
  const [extras, setExtras] = useState<ExtrasData>({ role: "student", acceptTerms: false });

  // UI state
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [emailChecking, setEmailChecking] = useState(false);
  const [emailAvailable, setEmailAvailable] = useState<boolean | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Basic password strength indicator
  const passwordStrength = (pw: string) => {
    let s = 0;
    if (pw.length >= 8) s++;
    if (pw.length >= 12) s++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
    if (/\d/.test(pw)) s++;
    if (/[^A-Za-z0-9]/.test(pw)) s++;
    return Math.min(4, s);
  };

  useEffect(() => {
    // reset server error when user edits
    setServerError(null);
  }, [account, profile, extras]);

  // ------------------- helpers -------------------
  const goNext = async () => {
    setErrors({});
    if (step === 1) {
      // validate account
      const result = accountSchema.safeParse(account);
      if (!result.success) {
        const zErr = result.error.format();
        const flat: Record<string, string> = {};
        for (const k in zErr) {
          // @ts-ignore
          if (typeof zErr[k]._errors !== "undefined") flat[k] = (zErr as any)[k]._errors?.[0];
        }
        setErrors(flat);
        return;
      }

      // check email uniqueness
      setEmailChecking(true);
      try {
        const r = await fetch("/api/auth/check-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: account.email }) });
        const j = await r.json();
        if (!r.ok) {
          setErrors({ email: j.message || "Could not verify email" });
          setEmailAvailable(null);
          setEmailChecking(false);
          return;
        }
        if (!j.available) {
          setErrors({ email: "Email is already registered" });
          setEmailAvailable(false);
          setEmailChecking(false);
          return;
        }
        setEmailAvailable(true);
        setEmailChecking(false);
        setStep(2);
      } catch (err) {
        setErrors({ email: "Could not verify email" });
        setEmailChecking(false);
      }
    } else if (step === 2) {
      const result = profileSchema.safeParse(profile);
      if (!result.success) {
        const flat: Record<string, string> = {};
        result.error.errors.forEach((e) => {
          if (e.path && e.path[0]) flat[e.path[0] as string] = e.message;
        });
        setErrors(flat);
        return;
      }
      setStep(3);
    }
  };

  const goBack = () => {
    setErrors({});
    setServerError(null);
    if (step > 1) setStep(step - 1);
  };

  const submit = async () => {
    setErrors({});
    setServerError(null);

    const extrasResult = extrasSchema.safeParse(extras);
    if (!extrasResult.success) {
      const flat: Record<string, string> = {};
      extrasResult.error.errors.forEach((e) => {
        if (e.path && e.path[0]) flat[e.path[0] as string] = e.message;
      });
      setErrors(flat);
      return;
    }

    // final combined payload (omit passwordConfirm)
    const payload = {
      email: account.email,
      password: account.password,
      fullName: profile.fullName,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl || null,
      role: extras.role,
    };

    setLoading(true);
    try {
      const r = await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await r.json();
      if (!r.ok) {
        setServerError(j.message || "Registration failed");
        setLoading(false);
        return;
      }
      // success
      setShowSuccess(true);
    } catch (err) {
      setServerError("Network error — try again");
    } finally {
      setLoading(false);
    }
  };

  // ------------------- small UI components -------------------
  function StepIndicator() {
    return (
      <div className="flex items-center gap-3 mb-6">
        {[1, 2, 3].map((n) => (
          <div key={n} className={`flex-1 text-center py-2 rounded ${n === step ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-600"}`}>
            {n === 1 ? "Account" : n === 2 ? "Profile" : "Extras"}
          </div>
        ))}
      </div>
    );
  }

  // ------------------- render steps -------------------
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow p-8">
        <h2 className="text-2xl font-semibold mb-2">Create your account</h2>
        <p className="text-sm text-gray-500 mb-6">A quick multi-step registration to get you started.</p>

        <StepIndicator />

        <div>
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Email</label>
                <input
                  value={account.email}
                  onChange={(e) => { setAccount((s) => ({ ...s, email: e.target.value })); setEmailAvailable(null); }}
                  type="email"
                  className={`mt-1 block w-full rounded-md border p-2 outline-none focus:ring-2 focus:ring-indigo-200 ${errors.email ? "border-red-400" : "border-gray-200"}`}
                  placeholder="you@company.com"
                />
                {emailChecking && <p className="text-xs text-gray-500 mt-1">Checking email…</p>}
                {emailAvailable === true && <p className="text-xs text-green-600 mt-1">Email is available</p>}
                {errors.email && <p className="text-sm text-red-500 mt-1">{errors.email}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Password</label>
                <input
                  value={account.password}
                  onChange={(e) => setAccount((s) => ({ ...s, password: e.target.value }))}
                  type="password"
                  className={`mt-1 block w-full rounded-md border p-2 outline-none focus:ring-2 focus:ring-indigo-200 ${errors.password ? "border-red-400" : "border-gray-200"}`}
                  placeholder="Choose a strong password"
                />
                <div className="mt-2 h-2 w-full bg-gray-100 rounded overflow-hidden">
                  <div className={`h-full transition-all duration-200 ${passwordStrength(account.password) <= 1 ? "bg-red-400" : passwordStrength(account.password) <= 2 ? "bg-yellow-400" : "bg-green-400"}`} style={{ width: `${(passwordStrength(account.password) / 4) * 100}%` }} />
                </div>
                {errors.password && <p className="text-sm text-red-500 mt-1">{errors.password}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Confirm password</label>
                <input
                  value={account.passwordConfirm}
                  onChange={(e) => setAccount((s) => ({ ...s, passwordConfirm: e.target.value }))}
                  type="password"
                  className={`mt-1 block w-full rounded-md border p-2 outline-none focus:ring-2 focus:ring-indigo-200 ${errors.passwordConfirm ? "border-red-400" : "border-gray-200"}`}
                  placeholder="Retype your password"
                />
                {errors.passwordConfirm && <p className="text-sm text-red-500 mt-1">{errors.passwordConfirm}</p>}
              </div>

              <div className="flex justify-end gap-2">
                <button onClick={goNext} className="px-4 py-2 rounded bg-indigo-600 text-white">Next</button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Full name</label>
                <input value={profile.fullName} onChange={(e) => setProfile((s) => ({ ...s, fullName: e.target.value }))} className={`mt-1 block w-full rounded-md border p-2 outline-none focus:ring-2 focus:ring-indigo-200 ${errors.fullName ? "border-red-400" : "border-gray-200"}`} />
                {errors.fullName && <p className="text-sm text-red-500 mt-1">{errors.fullName}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Display name</label>
                <input value={profile.displayName} onChange={(e) => setProfile((s) => ({ ...s, displayName: e.target.value }))} className={`mt-1 block w-full rounded-md border p-2 outline-none focus:ring-2 focus:ring-indigo-200 ${errors.displayName ? "border-red-400" : "border-gray-200"}`} />
                {errors.displayName && <p className="text-sm text-red-500 mt-1">{errors.displayName}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Avatar URL (optional)</label>
                <input value={profile.avatarUrl} onChange={(e) => setProfile((s) => ({ ...s, avatarUrl: e.target.value }))} className={`mt-1 block w-full rounded-md border p-2 outline-none focus:ring-2 focus:ring-indigo-200 ${errors.avatarUrl ? "border-red-400" : "border-gray-200"}`} placeholder="https://..." />
                {errors.avatarUrl && <p className="text-sm text-red-500 mt-1">{errors.avatarUrl}</p>}
              </div>

              <div className="flex justify-between gap-2">
                <button onClick={goBack} className="px-4 py-2 rounded border">Back</button>
                <button onClick={goNext} className="px-4 py-2 rounded bg-indigo-600 text-white">Next</button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Role</label>
                <select value={extras.role} onChange={(e) => setExtras((s) => ({ ...s, role: e.target.value as any }))} className={`mt-1 block w-full rounded-md border p-2 outline-none focus:ring-2 focus:ring-indigo-200 ${errors.role ? "border-red-400" : "border-gray-200"}`}>
                  <option value="student">Student</option>
                  <option value="instructor">Instructor</option>
                  <option value="other">Other</option>
                </select>
                {errors.role && <p className="text-sm text-red-500 mt-1">{errors.role}</p>}
              </div>

              <div className="flex items-start gap-3">
                <input id="terms" type="checkbox" checked={extras.acceptTerms} onChange={(e) => setExtras((s) => ({ ...s, acceptTerms: e.target.checked }))} className="mt-1" />
                <label htmlFor="terms" className="text-sm text-gray-700">I accept the <a className="underline">Terms</a> and <a className="underline">Privacy Policy</a></label>
              </div>
              {errors.acceptTerms && <p className="text-sm text-red-500 mt-1">{errors.acceptTerms}</p>}

              {serverError && <p className="text-sm text-red-500">{serverError}</p>}

              <div className="flex justify-between gap-2">
                <button onClick={goBack} className="px-4 py-2 rounded border">Back</button>
                <button onClick={submit} className="px-4 py-2 rounded bg-green-600 text-white" disabled={loading}>
                  {loading ? "Creating..." : "Create account"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Success modal */}
        {showSuccess && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl text-center">
              <h3 className="text-xl font-semibold mb-2">Welcome aboard!</h3>
              <p className="text-sm text-gray-600 mb-4">Your account has been created successfully. Check your email to verify your account if required.</p>
              <div className="flex justify-center gap-2">
                <button onClick={() => (window.location.href = "/auth/login")} className="px-4 py-2 rounded bg-indigo-600 text-white">Go to login</button>
                <button onClick={() => setShowSuccess(false)} className="px-4 py-2 rounded border">Close</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
