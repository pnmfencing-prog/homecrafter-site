// In-memory session store — swap with DB/Redis later
export interface Session {
  email: string;
  name: string;
  createdAt: number;
}

export const sessions = new Map<string, Session>();
