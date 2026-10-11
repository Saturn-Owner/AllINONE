const lockArtwork = `<svg viewBox="0 0 120 120" fill="none" aria-hidden="true">
  <path class="unlock-shackle" d="M40 55V38a20 20 0 0 1 40 0v17" />
  <rect class="unlock-lock-body" x="27" y="52" width="66" height="52" rx="15" />
  <circle class="unlock-keyhole" cx="60" cy="72" r="5" />
  <path class="unlock-keyhole-stem" d="M60 77v9" />
</svg>`;

export const gateLockArtwork = lockArtwork;

/** Show the celebration after decryption has actually succeeded. */
export async function revealWorkspace(root: HTMLElement, render: () => void): Promise<void> {
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const focusHeading = () => {
    const heading = root.querySelector<HTMLElement>(".page-heading h1");
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  };
  if (motion.matches) { render(); focusHeading(); return; }

  const scene = document.createElement("div");
  scene.className = "unlock-scene";
  scene.setAttribute("role", "status");
  scene.setAttribute("aria-live", "polite");
  scene.innerHTML = `<div class="unlock-scene-grid" aria-hidden="true"></div>
    <div class="unlock-center">
      <div class="unlock-orb" aria-hidden="true">
        <div class="unlock-halo"></div><div class="unlock-wave"></div>
        <svg class="unlock-orbit" viewBox="0 0 240 240" fill="none"><circle cx="120" cy="120" r="107" /><circle cx="120" cy="120" r="94" /></svg>
        <div class="unlock-sparks">${"<span></span>".repeat(8)}</div>
        <div class="unlock-lock">${lockArtwork}</div>
      </div>
      <span class="unlock-eyebrow">DEIN RAUM IST BEREIT</span>
      <h2>Tresor entsperrt.</h2><p>Willkommen in deinem Raum.</p>
    </div>`;

  root.inert = true;
  document.body.append(scene);
  let workspace: HTMLElement | null = null;
  try {
    render();
    workspace = root.querySelector<HTMLElement>(".workspace");
    workspace?.classList.add("unlock-workspace-enter");
    await new Promise<void>((resolve) => {
      const complete = () => {
        window.clearTimeout(fallback);
        scene.removeEventListener("animationend", onEnd);
        motion.removeEventListener("change", complete);
        resolve();
      };
      const onEnd = (event: AnimationEvent) => {
        if (event.target === scene && event.animationName === "unlock-scene-out") complete();
      };
      const fallback = window.setTimeout(complete, 1800);
      scene.addEventListener("animationend", onEnd);
      motion.addEventListener("change", complete);
    });
  } finally {
    scene.remove();
    root.inert = false;
    workspace?.classList.remove("unlock-workspace-enter");
    focusHeading();
  }
}
