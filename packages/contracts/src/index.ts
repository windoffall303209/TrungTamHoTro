export type ModuleKey = "storage" | "question-bank" | "forum" | "live-class";

export type ModuleReadiness = "foundation-ready" | "planned";

export interface TeachingModule {
  key: ModuleKey;
  name: string;
  description: string;
  readiness: ModuleReadiness;
}

export interface ApiEnvelope<T> {
  data: T;
  meta: {
    requestId: string;
    timestamp: string;
  };
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta: {
    requestId: string;
    timestamp: string;
  };
}

