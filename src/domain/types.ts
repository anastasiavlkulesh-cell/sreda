export type DimensionKey = "CUSTOMER" | "TEAM" | "LEADERSHIP" | "STANDARDS" | "BUSINESS_RESULTS";
export type SourceType = "OWNER" | "MANAGER" | "EMPLOYEE" | "CUSTOMER" | "MYSTERY_SHOPPER" | "BUSINESS_METRICS";
export type Confidence = "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT";
export type FindingStatus = "CONFIRMED" | "PARTIALLY_CONFIRMED" | "HYPOTHESIS";
export type PriorityCategory = "P1" | "P2" | "P3" | "P4";

export const DIMENSION_ORDER: DimensionKey[] = ["CUSTOMER", "TEAM", "LEADERSHIP", "STANDARDS", "BUSINESS_RESULTS"];

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  HIGH: "Высокая",
  MEDIUM: "Средняя",
  LOW: "Низкая",
  INSUFFICIENT: "Недостаточно данных",
};

export const FINDING_LABELS: Record<FindingStatus, string> = {
  CONFIRMED: "Подтверждено",
  PARTIALLY_CONFIRMED: "Частично подтверждено",
  HYPOTHESIS: "Гипотеза",
};
