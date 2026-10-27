export type AuthMode = "signup" | "login";
export type AuthErrors = { email?: string; password?: string; agreement?: string };

export function getPromptError(prompt: string): string {
  return prompt.trim() ? "" : "Describe your video or choose an example first.";
}

export function validateAuthFields({ mode, email, password, agreement }: { mode: AuthMode; email: string; password: string; agreement: boolean }): AuthErrors {
  const errors: AuthErrors = {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = "Enter a valid email address.";
  if (!password) errors.password = "Enter your password.";
  else if (mode === "signup" && password.length < 8) errors.password = "Use at least 8 characters.";
  if (mode === "signup" && !agreement) errors.agreement = "Confirm your age and agreement to continue.";
  return errors;
}
