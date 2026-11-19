import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().email("Введите корректный e-mail");
export const passwordSchema = z
  .string()
  .min(10, "Пароль — не короче 10 символов")
  .max(200, "Слишком длинный пароль")
  .refine((p) => /[A-Za-zА-Яа-я]/.test(p) && /\d/.test(p), "Пароль должен содержать буквы и цифры");

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Укажите имя").max(100),
  email: emailSchema,
  password: passwordSchema,
  consent: z.literal("on", { error: "Необходимо согласие на обработку персональных данных" }),
  inviteToken: z.string().optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Введите пароль"),
  next: z.string().optional(),
});

export const INDUSTRIES = {
  general: "Другое / универсальная методика",
  horeca: "Кафе и рестораны",
  retail: "Розничная торговля",
  beauty: "Салоны красоты и услуги",
  medical: "Медицинские клиники",
  fitness: "Фитнес и спорт",
  education: "Образование",
  hotels: "Гостиницы",
} as const;

export const createOrgSchema = z.object({
  name: z.string().trim().min(2, "Укажите название компании").max(120),
  industry: z.enum(Object.keys(INDUSTRIES) as [keyof typeof INDUSTRIES, ...(keyof typeof INDUSTRIES)[]]),
  locationName: z.string().trim().min(2, "Укажите название точки").max(120),
  city: z.string().trim().max(80).optional(),
});

export const locationSchema = z.object({
  name: z.string().trim().min(2, "Укажите название").max(120),
  city: z.string().trim().max(80).optional(),
  address: z.string().trim().max(200).optional(),
});

export const roleKeySchema = z.enum(["OWNER", "NETWORK_MANAGER", "LOCATION_MANAGER", "MANAGER", "EMPLOYEE", "PLATFORM_EXPERT"]);

export const inviteSchema = z.object({
  email: emailSchema,
  roleKey: roleKeySchema,
  locationIds: z.union([z.string(), z.array(z.string())]).optional(),
  expiresInDays: z.coerce.number().int().min(1).max(365).optional(),
});

export function toArray(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return (Array.isArray(v) ? v : [v]).filter(Boolean);
}
