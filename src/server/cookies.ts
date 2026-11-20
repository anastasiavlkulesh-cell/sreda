/** Cookie с флагом Secure только при работе по HTTPS — иначе браузер их отбросит (например, при доступе по IP). */
export const cookieOptions = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: (process.env.APP_URL ?? "").startsWith("https://"),
  path: "/",
});
