export interface ActionState {
  ok: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string[]>;
  data?: unknown;
}

export const initialActionState: ActionState = { ok: false };
