import type { Config } from "tailwindcss";
export default { content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"], theme: { extend: { colors: { ink: "#14213d", accent: "#0f766e" } } }, plugins: [] } satisfies Config;
