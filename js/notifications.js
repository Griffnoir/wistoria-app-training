export async function requestNotificationPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const permission = await Notification.requestPermission();
  return permission === "granted";
}

export async function notify(title, body) {
  const allowed = await requestNotificationPermission();
  if (!allowed) return;
  new Notification(title, {
    body,
    icon: "assets/icons/icon.svg"
  });
}

export function toast(message, tone = "info") {
  const stack = document.getElementById("toastStack");
  if (!stack) return;
  const item = document.createElement("div");
  item.className = `toast ${tone}`;
  item.textContent = message;
  stack.append(item);
  setTimeout(() => item.remove(), 3400);
}
