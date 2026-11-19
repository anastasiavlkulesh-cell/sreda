export const DIAGNOSTIC_STATUS_LABELS = {
  DRAFT: "Черновик",
  COLLECTING: "Сбор данных",
  ANALYZING: "Анализ",
  COMPLETED: "Завершена",
  ARCHIVED: "В архиве",
} as const;

export const DIAGNOSTIC_STATUS_VARIANT = {
  DRAFT: "outline",
  COLLECTING: "lavender",
  ANALYZING: "peach",
  COMPLETED: "good",
  ARCHIVED: "neutral",
} as const;

export const TASK_STATUS_LABELS = {
  NEW: "Новая",
  PENDING_APPROVAL: "На согласовании",
  PLANNED: "Запланирована",
  IN_PROGRESS: "В работе",
  IN_REVIEW: "На проверке",
  DONE: "Выполнена",
  OVERDUE: "Просрочена",
  NEEDS_REVISION: "Требует пересмотра",
} as const;

export const TASK_STATUS_VARIANT = {
  NEW: "outline",
  PENDING_APPROVAL: "peach",
  PLANNED: "neutral",
  IN_PROGRESS: "lavender",
  IN_REVIEW: "basic",
  DONE: "good",
  OVERDUE: "critical",
  NEEDS_REVISION: "warning",
} as const;

export const TASK_OUTCOME_LABELS = {
  NOT_EVALUATED: "Результат не оценён",
  AWAITING_REMEASURE: "Ожидает повторного замера",
  IMPROVED: "Улучшение подтверждено замером",
  NO_EFFECT: "Эффект не подтверждён",
} as const;

export const PLAN_STATUS_LABELS = {
  DRAFT: "Черновик",
  PENDING_APPROVAL: "На утверждении",
  APPROVED: "Утверждён",
  ARCHIVED: "В архиве",
} as const;

export const PROBLEM_STATUS_LABELS = {
  OPEN: "Открыта",
  IN_PLAN: "В плане",
  MONITORING: "На контроле",
  RESOLVED: "Устранена",
  DISMISSED: "Отклонена",
} as const;
