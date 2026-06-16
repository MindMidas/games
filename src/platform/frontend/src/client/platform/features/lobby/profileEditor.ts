import { updateProfile } from "./lobbyNet.js";
import { resolvePhotoUrl, getDefaultAvatar } from "../../shared/lib/security.js";
import { setImageWithFallback } from "../../shared/lib/images.js";
import { safeText } from "../../shared/lib/utils.js";

interface ProfileUser {
  username?: string;
  photo_url?: string | null;
}

interface ProfileEditorRefs {
  userName?: HTMLElement | null;
  userAvatar?: HTMLImageElement | null;
  usernameInput?: HTMLInputElement | null;
  photoInput?: HTMLInputElement | null;
  saveButton?: HTMLButtonElement | null;
  matchmakingSelfName?: HTMLElement | null;
  matchmakingSelfAvatar?: HTMLImageElement | null;
}

interface ProfileEditorDeps {
  refs?: ProfileEditorRefs;
  notify?: (message: string, isError?: boolean) => void;
  getUser?: () => ProfileUser | null;
  onUserUpdated?: (user: ProfileUser | null) => void;
}

export function createProfileEditor(deps: ProfileEditorDeps = {}) {
  const {
    refs = {},
    notify = () => {},
    getUser = () => null,
    onUserUpdated = () => {},
  } = deps;

  let bound = false;

  function renderUser(user: ProfileUser | null): void {
    const username = safeText(user?.username, "Player");
    const photoUrl = resolvePhotoUrl(user?.photo_url, getDefaultAvatar());
    if (refs.userName) {
      refs.userName.textContent = username;
    }
    if (refs.usernameInput) {
      refs.usernameInput.value = safeText(user?.username, "");
    }
    if (refs.photoInput) {
      refs.photoInput.value = safeText(user?.photo_url, "");
    }
    if (refs.userAvatar) {
      setImageWithFallback(refs.userAvatar, photoUrl);
    }
    if (refs.matchmakingSelfName) {
      refs.matchmakingSelfName.textContent = username;
    }
    if (refs.matchmakingSelfAvatar) {
      setImageWithFallback(refs.matchmakingSelfAvatar, photoUrl);
    }
  }

  function reset(): void {
    renderUser(null);
  }

  async function saveProfile(): Promise<void> {
    const user = getUser();
    if (!user) {
      notify("Login required.", true);
      return;
    }

    const username = safeText(refs.usernameInput?.value, "");
    const photoUrl = safeText(refs.photoInput?.value, "");
    if (!username) {
      notify("Username is required.", true);
      return;
    }

    if (refs.saveButton) {
      refs.saveButton.disabled = true;
    }
    try {
      const result = await updateProfile(username, photoUrl || null);
      const updatedUser = result.user as ProfileUser | null;
      onUserUpdated(updatedUser);
      renderUser(updatedUser);
      notify("Profile updated.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Profile update failed.", true);
    } finally {
      if (refs.saveButton) {
        refs.saveButton.disabled = false;
      }
    }
  }

  function bindEnter(inputEl: HTMLInputElement | null | undefined, handler: () => Promise<void>): void {
    inputEl?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void handler();
      }
    });
  }

  function bindEvents(): void {
    if (bound) {
      return;
    }
    bound = true;
    refs.saveButton?.addEventListener("click", () => {
      void saveProfile();
    });
    bindEnter(refs.usernameInput, saveProfile);
    bindEnter(refs.photoInput, saveProfile);
  }

  return {
    bindEvents,
    renderUser,
    reset,
    saveProfile,
  };
}
