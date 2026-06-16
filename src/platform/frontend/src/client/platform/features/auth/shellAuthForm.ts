export type AuthMode = "signin" | "signup";

export interface AuthFormRefs {
  loginCard: HTMLElement | null;
  loginPasswordInput: HTMLInputElement | null;
  loginPasswordToggle: HTMLButtonElement | null;
  modeSigninButton: HTMLButtonElement | null;
  modeSignupButton: HTMLButtonElement | null;
  registerCard: HTMLElement | null;
  registerPasswordInput: HTMLInputElement | null;
  registerPasswordToggle: HTMLButtonElement | null;
}

export function bindEnter(
  input: HTMLInputElement | null,
  handler: () => Promise<void>,
): void {
  input?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    void handler();
  });
}

function syncPasswordToggle(
  button: HTMLButtonElement | null,
  input: HTMLInputElement | null,
): void {
  if (!button || !input) {
    return;
  }
  const hidden = input.type === "password";
  button.classList.toggle("is-hidden", hidden);
  button.classList.toggle("is-visible", !hidden);
  button.setAttribute("aria-label", hidden ? "Show password" : "Hide password");
  button.setAttribute("title", hidden ? "Show password" : "Hide password");
}

function bindPasswordToggle(
  button: HTMLButtonElement | null,
  input: HTMLInputElement | null,
): void {
  if (!button || !input) {
    return;
  }
  button.addEventListener("click", () => {
    input.type = input.type === "password" ? "text" : "password";
    syncPasswordToggle(button, input);
  });
  syncPasswordToggle(button, input);
}

export function createAuthForm(refs: AuthFormRefs): {
  applyMode(mode: AuthMode): void;
  bindPasswordToggles(): void;
  clearInputs(): void;
} {
  let currentMode: AuthMode = "signin";
  return {
    applyMode(mode: AuthMode): void {
      currentMode = mode === "signup" ? "signup" : "signin";
      const signin = currentMode === "signin";
      refs.modeSigninButton?.classList.toggle("is-active", signin);
      refs.modeSignupButton?.classList.toggle("is-active", !signin);
      refs.modeSigninButton?.setAttribute("aria-selected", signin ? "true" : "false");
      refs.modeSignupButton?.setAttribute("aria-selected", signin ? "false" : "true");
      refs.loginCard?.classList.toggle("hidden", !signin);
      refs.registerCard?.classList.toggle("hidden", signin);
    },
    bindPasswordToggles(): void {
      bindPasswordToggle(refs.loginPasswordToggle, refs.loginPasswordInput);
      bindPasswordToggle(refs.registerPasswordToggle, refs.registerPasswordInput);
    },
    clearInputs(): void {
      if (refs.loginPasswordInput) {
        refs.loginPasswordInput.value = "";
        refs.loginPasswordInput.type = "password";
      }
      if (refs.registerPasswordInput) {
        refs.registerPasswordInput.value = "";
        refs.registerPasswordInput.type = "password";
      }
      syncPasswordToggle(refs.loginPasswordToggle, refs.loginPasswordInput);
      syncPasswordToggle(refs.registerPasswordToggle, refs.registerPasswordInput);
    },
  };
}
