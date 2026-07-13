export function animateNumbers(root = document) {
  root.querySelectorAll("[data-count]").forEach((node) => {
    const target = Number(node.dataset.count || 0);
    const start = performance.now();
    const duration = 640;
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      node.textContent = Math.round(target * progress).toLocaleString("fr-FR");
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

export function observeCards(root = document) {
  const cards = root.querySelectorAll(".panel, .card, .program-card, .exercise-card, .metric");
  if (!("IntersectionObserver" in window)) {
    cards.forEach((card) => card.classList.add("animate-in"));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("animate-in");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });
  cards.forEach((card, index) => {
    card.style.animationDelay = `${Math.min(index * 32, 180)}ms`;
    observer.observe(card);
  });
}
