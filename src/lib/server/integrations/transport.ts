// How an adapter talks to a source system. The adapter builds each request exactly as the system's public documentation
// describes it, without credentials; a transport delivers it. This build has two transports: one that answers from
// recorded sample responses (tests and the Settings sample), and one that refuses, because no live account is connected.
// A live transport (OAuth2 for Lightspeed, ClientToken and AccessToken for Mews) is the step after sandbox testing.

export type SourceSystem = "lightspeed" | "mews" | "simphony";

export interface SourceRequest {
  system: SourceSystem;
  method: "GET" | "POST";
  /** Path below the system's base address, as documented: "/f/v2/business-location/{id}/sales-daily". */
  path: string;
  query?: Record<string, string>;
  /** JSON body for POST. Never carries tokens: a live transport adds them. */
  body?: Record<string, unknown>;
}

export type Transport = (req: SourceRequest) => Promise<unknown>;

export class NotConnectedError extends Error {
  constructor(system: SourceSystem) {
    super(`${system === "lightspeed" ? "Lightspeed" : system === "mews" ? "Mews" : "Simphony"} is not connected to a live account in this demo.`);
  }
}

/** The transport every adapter gets until a hotel's sandbox account is tested: it makes no call and says so. */
export const notConnected: Transport = async (req) => {
  throw new NotConnectedError(req.system);
};

/** Wraps a transport and keeps every request it was given, so a test or the Settings page can show what was asked. */
export function recording(inner: Transport): Transport & { requests: SourceRequest[] } {
  const requests: SourceRequest[] = [];
  const t = (async (req: SourceRequest) => {
    requests.push(req);
    return inner(req);
  }) as Transport & { requests: SourceRequest[] };
  t.requests = requests;
  return t;
}

/** Credential fields a request built by an adapter must never carry. Checked in tests. */
export const CREDENTIAL_FIELDS = ["ClientToken", "AccessToken", "access_token", "Authorization", "client_secret", "apiKey"];
