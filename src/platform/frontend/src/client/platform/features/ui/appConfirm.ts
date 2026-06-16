interface ConfirmOptions {
  title?: string;
}

export function confirmApp(message: string, opts: ConfirmOptions = {}): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const overlay = document.getElementById("app-confirm-overlay");
    const msgEl = document.getElementById("app-confirm-message");
    const titleEl = document.getElementById("app-confirm-title");
    const okBtn = document.getElementById("app-confirm-ok-btn");
    const cancelBtn = document.getElementById("app-confirm-cancel-btn");
    if (!overlay || !okBtn || !cancelBtn) {
      resolve(false);
      return;
    }
    const newTitle =
      typeof opts.title === "string" && opts.title.trim() ? opts.title.trim() : null;
    let prevTitle = "";
    if (titleEl && newTitle) {
      prevTitle = titleEl.textContent || "";
      titleEl.textContent = newTitle;
    }
    if (msgEl) msgEl.textContent = message;
    overlay.classList.remove("hidden");
    overlay.style.display = "flex";
    let finished = false;
    let lastPointerUpAt = 0;
    const cleanup = (result: boolean): void => {
      if (finished) return;
      finished = true;
      okBtn.removeEventListener("pointerup", onOkPointerUp);
      okBtn.removeEventListener("click", onOkClick);
      cancelBtn.removeEventListener("pointerup", onCancelPointerUp);
      cancelBtn.removeEventListener("click", onCancelClick);
      overlay.classList.add("hidden");
      overlay.style.display = "";
      if (titleEl && newTitle) titleEl.textContent = prevTitle;
      resolve(result);
    };
    const onOkPointerUp = (event: PointerEvent): void => {
      if (!event?.isPrimary || event?.pointerType === "mouse") return;
      event.preventDefault();
      lastPointerUpAt = Date.now();
      cleanup(true);
    };
    const onCancelPointerUp = (event: PointerEvent): void => {
      if (!event?.isPrimary || event?.pointerType === "mouse") return;
      event.preventDefault();
      lastPointerUpAt = Date.now();
      cleanup(false);
    };
    const onOkClick = (event: MouseEvent): void => {
      if (Date.now() - lastPointerUpAt < 400) {
        event.preventDefault();
        return;
      }
      cleanup(true);
    };
    const onCancelClick = (event: MouseEvent): void => {
      if (Date.now() - lastPointerUpAt < 400) {
        event.preventDefault();
        return;
      }
      cleanup(false);
    };
    okBtn.addEventListener("pointerup", onOkPointerUp);
    okBtn.addEventListener("click", onOkClick);
    cancelBtn.addEventListener("pointerup", onCancelPointerUp);
    cancelBtn.addEventListener("click", onCancelClick);
  });
}
