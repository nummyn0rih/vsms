import type { NextConfig } from "next";

// Заголовки безопасности на все маршруты. CSP намеренно НЕ добавляем: Next
// инлайнит скрипты гидратации, строгая политика их заблокирует (отдельная задача
// с nonce). Остальное — базовая защита: только HTTPS, запрет фрейминга (внутренняя
// система, встраивать некуда), запрет MIME-sniffing, урезанный Referer и
// отключённые камера/микрофон/геолокация.
const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
