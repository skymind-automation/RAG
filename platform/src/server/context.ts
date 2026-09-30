import type { Permission, Role } from "@/lib/permissions";

/**
 * The server-side identity of the current request. Constructed only by
 * src/server/auth/context.ts from the verified session and the database —
 * never from anything the client sent.
 */

export interface RequestMeta {
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface AuthContext {
  user: AuthUser;
  request: RequestMeta;
}

export interface OrgContext extends AuthContext {
  organization: {
    id: string;
    slug: string;
    name: string;
    timezone: string;
    ticketPrefix: string;
    ticketNumberPadding: number;
  };
  membership: { id: string; role: Role };
  role: Role;
  permissions: ReadonlySet<Permission>;
}

export const SYSTEM_REQUEST: RequestMeta = {
  requestId: "system",
  ipAddress: null,
  userAgent: null,
};
